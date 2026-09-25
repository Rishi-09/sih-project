"""
Vectorized lumped engine model with health factors.

`nominal_targets` is a NumPy port of retribution/simulator/sensors.py
NominalSensorModel.compute_nominal_targets — same equations, evaluated on whole
arrays instead of one second at a time (tests/test_physics_parity.py pins the
two together). The live simulator costs ~1 ms per step; a 20-engine fleet at
1 Hz would take ~20 minutes that way and takes seconds this way.

`apply_health` is the new layer: 8 physical health factors that degrade the
steady-state targets. A fault is no longer a scripted per-channel delta, it is
a change in an engine property, and every channel it touches follows from the
physics. That is what lets M2 estimate the property back from telemetry.

    ve          volumetric efficiency (induction leak)            1.0 healthy, fails < 0.85
    eta_turbo   turbocharger efficiency                           1.0 healthy, fails < 0.72
    comb_1..4   per-cylinder combustion index (plugs, ignition)   1.0 healthy, fails < 0.62
    oil_res     oil circuit resistance (filter / relief valve)    1.0 healthy, fails > 1.70
    cool_eff    coolant circuit effectiveness (restriction)       1.0 healthy, fails < 0.62
"""

from typing import Dict, Optional

import numpy as np
from scipy.signal import lfilter

from . import ensure_simulator_path

ensure_simulator_path()
from simulator.config import DEFAULT_CONFIG as CFG

HF_NAMES = ["ve", "eta_turbo", "comb_1", "comb_2", "comb_3", "comb_4", "oil_res", "cool_eff"]
HF_HEALTHY = np.ones(len(HF_NAMES))
HF_FAIL = np.array([0.85, 0.72, 0.62, 0.62, 0.62, 0.62, 1.70, 0.62])
HF_LABEL = {
    "ve": "Volumetric efficiency",
    "eta_turbo": "Turbo efficiency",
    "comb_1": "Combustion index cyl 1",
    "comb_2": "Combustion index cyl 2",
    "comb_3": "Combustion index cyl 3",
    "comb_4": "Combustion index cyl 4",
    "oil_res": "Oil circuit resistance",
    "cool_eff": "Cooling effectiveness",
}

# Channels that are measurements. cht_1..4 are derived onboard from coolant,
# fuel flow and EGT (contract/sensors.json), so they carry no independent
# evidence and are never used for trust or health estimation.
FIT_CHANNELS = [
    "rpm", "vib_rms_g", "egt_1", "egt_2", "egt_3", "egt_4",
    "coolant_temp_c", "oil_press_bar", "oil_temp_c", "map_kpa", "fuel_flow_lph",
]
SENSOR_CHANNELS = [
    "rpm", "vib_rms_g", "egt_1", "egt_2", "egt_3", "egt_4",
    "cht_1", "cht_2", "cht_3", "cht_4", "coolant_temp_c",
    "oil_press_bar", "oil_temp_c", "map_kpa", "fuel_flow_lph", "fuel_press_bar",
    "inj_timing_deg", "bus_voltage_v", "alt_current_a",
]
CYL_EGT_OFFSETS = np.array([-4.0, 5.0, 3.0, -3.0])

# Redlines used by M5/M8 (from simulator config)
REDLINE = {ch: v[0] for ch, v in CFG.redline_limits.items()}  # value only; oil_press, fuel_press, bus_voltage are LOW limits


def health_deficit(theta: np.ndarray) -> np.ndarray:
    """Per-factor progress toward failure: 0 = healthy, 1 = at the failure threshold."""
    theta = np.asarray(theta, dtype=float)
    return np.clip((theta - HF_HEALTHY) / (HF_FAIL - HF_HEALTHY), 0.0, None)


def _air_density_ratio(alt_m):
    t_k = np.maximum(200.0, 288.15 - 0.0065 * alt_m)
    return (t_k / 288.15) ** 4.2561


def _pressure_ratio(alt_m):
    t_k = np.maximum(200.0, 288.15 - 0.0065 * alt_m)
    return (t_k / 288.15) ** 5.2561


def derived_cht(coolant, fuel_flow, egts):
    """cht_k = coolant + 25 + 0.3*(ff - 12) + 0.15*(egt_k - mean(egt))  (egts: (4, n))"""
    mean_egt = egts.mean(axis=0)
    return coolant + 25.0 + 0.3 * (fuel_flow - 12.0) + 0.15 * (egts - mean_egt)


def nominal_targets(throttle_pct, alt_m, oat_c, ias_kt, phase) -> Dict[str, np.ndarray]:
    """Healthy steady-state targets for all 19 channels. Arrays in, arrays out."""
    c = CFG
    throttle = np.clip(np.asarray(throttle_pct, float), 0.0, 100.0)
    alt = np.maximum(0.0, np.asarray(alt_m, float))
    oat = np.asarray(oat_c, float)
    ias = np.maximum(0.0, np.asarray(ias_kt, float))
    phase = np.char.upper(np.asarray(phase, dtype=str))
    u = throttle / 100.0

    # 1. RPM & vibration
    base_rpm = c.rpm_idle + (c.rpm_max_takeoff - c.rpm_idle) * u ** 0.85
    rpm = np.clip(base_rpm + (ias - 70.0) * 0.45, c.rpm_idle, c.rpm_max_takeoff)
    ground = np.isin(phase, ["STARTUP", "SHUTDOWN"]) & (u < 0.05)
    ground_rpm = np.where((phase == "SHUTDOWN") & (u == 0.0), 0.0, c.rpm_idle * 0.5)
    rpm = np.where(ground, ground_rpm, rpm)

    base_vib = c.vib_normal_min + (c.vib_normal_max - c.vib_normal_min) * u ** 1.1
    vib = np.clip(base_vib, c.vib_normal_min, c.vib_redline)

    # 2. MAP with TCU
    m1 = c.map_idle + (u / 0.15) * (60.0 - c.map_idle)
    m2 = 60.0 + ((u - 0.15) / 0.55) * (c.map_cruise - 60.0)
    m3 = c.map_cruise + ((u - 0.70) / 0.20) * (c.map_max_continuous - c.map_cruise)
    m4 = c.map_max_continuous + ((u - 0.90) / 0.10) * (c.map_takeoff_boost - c.map_max_continuous)
    base_map = np.where(u <= 0.15, m1, np.where(u <= 0.70, m2, np.where(u <= 0.90, m3, m4)))
    loss = _pressure_ratio(alt) / max(0.01, float(_pressure_ratio(c.critical_altitude_m)))
    map_kpa = np.where(alt <= c.critical_altitude_m, base_map, np.maximum(c.map_idle, base_map * loss))

    # 3. Fuel
    flow_ratio = (rpm / c.rpm_max_takeoff) * (map_kpa / c.map_takeoff_boost)
    ff = c.fuel_flow_idle + (c.fuel_flow_takeoff - c.fuel_flow_idle) * flow_ratio ** 1.1
    ff = np.clip(ff, c.fuel_flow_idle, c.fuel_flow_takeoff)
    fuel_press = np.full_like(u, c.fuel_press_nominal)
    inj = 22.0 + u * 4.5

    # 4. Oil
    h_ram = np.sqrt(np.maximum(10.0, ias) / 100.0) * np.maximum(0.2, _air_density_ratio(alt)) ** 0.8
    oil_t = 85.0 + 18.0 * u ** 1.1 + np.clip((oat - 15.0) * 0.20, -6.0, 10.0) - np.clip(h_ram * 4.0, 0.0, 6.0)
    oil_t = np.clip(oil_t, c.oil_temp_min, c.oil_temp_redline - 5.0)
    visc = np.maximum(0.0, (oil_t - 90.0) * 0.025)
    rpm_ratio = (rpm - c.rpm_idle) / max(1.0, c.rpm_max_continuous - c.rpm_idle)
    floor = np.where(rpm < 3500.0, c.oil_press_min_idle, c.oil_press_min_continuous)
    oil_p = np.clip(floor + rpm_ratio * (c.oil_press_normal_max - floor) - visc,
                    c.oil_press_min_idle, c.oil_press_normal_max)

    # 5. Coolant
    coolant = 75.0 + 22.0 * u ** 1.25 + (oat - 15.0) * 0.40 - np.clip(h_ram * 7.5, 0.0, 9.0)
    coolant = np.clip(coolant, c.coolant_normal_min, c.coolant_caution_max - 5.0)

    # 6. EGT
    e1 = 730.0 + (u / 0.2) * 50.0
    e2 = 780.0 + ((u - 0.2) / 0.55) * 65.0
    e3 = 845.0 - ((u - 0.75) / 0.25) * 35.0
    base_egt = np.where(u < 0.2, e1, np.where(u <= 0.75, e2, e3))
    egts = np.clip(base_egt[None, :] + CYL_EGT_OFFSETS[:, None], c.egt_normal_min - 30.0, c.egt_caution_max - 20.0)

    chts = derived_cht(coolant, ff, egts)

    # 8. Electrical
    bus_v = np.where(rpm > 1800.0, c.bus_voltage_nominal, 12.6 + (rpm / 1800.0) * 1.4)
    alt_a = np.where(rpm > 1800.0, 18.0 + u * 12.0, np.maximum(0.0, (rpm / 1800.0) * 15.0))

    out = {
        "rpm": rpm, "vib_rms_g": vib,
        "coolant_temp_c": coolant, "oil_press_bar": oil_p, "oil_temp_c": oil_t,
        "map_kpa": map_kpa, "fuel_flow_lph": ff, "fuel_press_bar": fuel_press,
        "inj_timing_deg": inj, "bus_voltage_v": bus_v, "alt_current_a": alt_a,
    }
    for k in range(4):
        out[f"egt_{k + 1}"] = egts[k]
        out[f"cht_{k + 1}"] = chts[k]
    return out


# Physics coefficients of the health layer. The twin always uses these defaults;
# the robustness test simulates engines whose true coefficients differ (model mismatch).
COEF = {
    "turbo_map": 1.6, "turbo_egt": 250.0, "turbo_oil": 12.0, "rpm_air": 600.0, "rpm_comb": 150.0,
    "comb_egt": 350.0, "vib": 0.6, "oil_press_exp": 0.9, "oil_res_temp": 20.0, "cool_oil": 12.0,
    "cool_coolant": 80.0,
}


def apply_health(targets: Dict[str, np.ndarray], throttle_pct, theta, coef: Optional[dict] = None) -> Dict[str, np.ndarray]:
    """Degrade healthy steady-state targets by the 8 health factors."""
    kc = COEF if coef is None else coef
    ve, eta, c1, c2, c3, c4, r_oil, h_cool = np.asarray(theta, float)
    comb = np.array([c1, c2, c3, c4])
    u = np.clip(np.asarray(throttle_pct, float), 0.0, 100.0) / 100.0
    running = targets["rpm"] > 0.0
    thermal_load = 0.3 + 0.7 * u

    out = dict(targets)
    # Turbo: less boost above the wastegate knee, hotter exhaust, hotter oil (oil-cooled bearing)
    map_h = targets["map_kpa"] - kc["turbo_map"] * (1.0 - eta) * np.maximum(0.0, targets["map_kpa"] - 60.0)
    air = (map_h / np.maximum(1.0, targets["map_kpa"])) * ve  # delivered charge vs healthy
    out["map_kpa"] = map_h
    out["fuel_flow_lph"] = targets["fuel_flow_lph"] * air ** 1.1  # FADEC meters to air mass
    rpm_loss = (kc["rpm_air"] * (1.0 - air) + kc["rpm_comb"] * np.sum(1.0 - comb)) * u
    out["rpm"] = np.where(running, targets["rpm"] - rpm_loss, targets["rpm"])

    egts = np.stack([targets[f"egt_{k + 1}"] for k in range(4)])
    egts = egts + kc["turbo_egt"] * (1.0 - eta) * u - kc["comb_egt"] * (1.0 - comb)[:, None] * (0.4 + 0.6 * u)
    for k in range(4):
        out[f"egt_{k + 1}"] = egts[k]

    worst = max(0.0, 1.0 - float(comb.min()))
    out["vib_rms_g"] = targets["vib_rms_g"] + np.where(running, kc["vib"] * worst ** 1.1, 0.0)

    out["oil_press_bar"] = targets["oil_press_bar"] / r_oil ** kc["oil_press_exp"]
    out["oil_temp_c"] = (targets["oil_temp_c"] + kc["turbo_oil"] * (1.0 - eta) * u
                         + kc["oil_res_temp"] * (r_oil - 1.0) * thermal_load + kc["cool_oil"] * (1.0 - h_cool) * thermal_load)
    out["coolant_temp_c"] = targets["coolant_temp_c"] + kc["cool_coolant"] * (1.0 - h_cool) * thermal_load

    chts = derived_cht(out["coolant_temp_c"], out["fuel_flow_lph"], egts)
    for k in range(4):
        out[f"cht_{k + 1}"] = chts[k]
    return out


def steady_state(throttle_pct, alt_m, oat_c, ias_kt, phase, theta, mismatch: Optional[dict] = None) -> Dict[str, np.ndarray]:
    tgt = nominal_targets(throttle_pct, alt_m, oat_c, ias_kt, phase)
    if mismatch:
        # operating-point-dependent error in the healthy model itself (not a constant: L1 cannot absorb it)
        u = np.clip(np.asarray(throttle_pct, float), 0.0, 100.0) / 100.0
        for ch, per_u in mismatch.get("nominal", {}).items():
            tgt[ch] = tgt[ch] + per_u * (u - 0.6)
    return apply_health(tgt, throttle_pct, theta, coef=mismatch.get("coef") if mismatch else None)


# ── Dynamics and noise (vectorized equivalents of simulator/thermal.py) ──────

NON_THERMAL_TAU = {
    "rpm": 1.2, "vib_rms_g": 0.5, "oil_press_bar": 2.0, "map_kpa": 0.8,
    "fuel_flow_lph": 1.5, "fuel_press_bar": 1.0, "inj_timing_deg": 0.5,
    "bus_voltage_v": 0.5, "alt_current_a": 1.0,
}
THERMAL_TAU = {"egt": 0.8, "coolant_temp_c": 25.0, "oil_temp_c": 45.0, "cht": 15.0}
ADC_LSB = {
    "egt_1": 0.5, "egt_2": 0.5, "egt_3": 0.5, "egt_4": 0.5,
    "cht_1": 0.25, "cht_2": 0.25, "cht_3": 0.25, "cht_4": 0.25,
    "oil_temp_c": 0.25, "coolant_temp_c": 0.25, "oil_press_bar": 0.01, "fuel_press_bar": 0.01,
    "map_kpa": 0.05, "fuel_flow_lph": 0.05, "bus_voltage_v": 0.02, "alt_current_a": 0.1,
    "rpm": 1.0, "vib_rms_g": 0.001, "inj_timing_deg": 0.1,
}


def first_order_lag(x: np.ndarray, tau: float, y0: Optional[float] = None) -> np.ndarray:
    """y[k] = a*x[k] + (1-a)*y[k-1], y[-1] = y0 (default x[0], i.e. settled)  (dt = 1 s)."""
    a = 1.0 - np.exp(-1.0 / max(0.01, tau))
    start = float(x[0]) if y0 is None else float(y0)
    y, _ = lfilter([a], [1.0, -(1.0 - a)], x, zi=[(1.0 - a) * start])
    return np.asarray(y)


def apply_dynamics(targets: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    """Thermal network + first-order lags, deterministic."""
    out = {}
    for ch, tau in NON_THERMAL_TAU.items():
        out[ch] = first_order_lag(targets[ch], tau)
    egts = np.stack([first_order_lag(targets[f"egt_{k + 1}"], THERMAL_TAU["egt"]) for k in range(4)])
    out["coolant_temp_c"] = first_order_lag(targets["coolant_temp_c"], THERMAL_TAU["coolant_temp_c"])
    out["oil_temp_c"] = first_order_lag(targets["oil_temp_c"], THERMAL_TAU["oil_temp_c"])
    cht_ss = derived_cht(out["coolant_temp_c"], targets["fuel_flow_lph"], egts)
    for k in range(4):
        out[f"egt_{k + 1}"] = egts[k]
        out[f"cht_{k + 1}"] = first_order_lag(cht_ss[k], THERMAL_TAU["cht"])
    return out


def _pink(rng: np.random.Generator, n: int, std: float, phi: float = 0.92) -> np.ndarray:
    e = rng.normal(0.0, std, n) * np.sqrt(1.0 - phi ** 2)
    return np.asarray(lfilter([1.0], [1.0, -phi], e))


def sensor_noise(rng: np.random.Generator, n: int, rpm: np.ndarray) -> Dict[str, np.ndarray]:
    """Correlated 1/f noise, same structure and magnitudes as CorrelatedNoiseEngine."""
    exhaust, mech, hyd = _pink(rng, n, 3.2), _pink(rng, n, 0.012), _pink(rng, n, 0.035)
    noise = {f"egt_{k}": exhaust + _pink(rng, n, 1.5) for k in range(1, 5)}
    t = np.arange(n, dtype=float)
    noise.update({
        "inj_timing_deg": _pink(rng, n, 0.08),
        "oil_temp_c": _pink(rng, n, 0.10),
        "coolant_temp_c": _pink(rng, n, 0.12),
        "oil_press_bar": hyd + _pink(rng, n, 0.015),
        "map_kpa": _pink(rng, n, 0.30),
        "fuel_press_bar": 0.5 * hyd + _pink(rng, n, 0.01),
        "fuel_flow_lph": _pink(rng, n, 0.20),
        "vib_rms_g": mech + _pink(rng, n, 0.004),
        "rpm": mech * 350.0 + _pink(rng, n, 6.0),
        "bus_voltage_v": _pink(rng, n, 0.03) + 0.06 * np.sin(2 * np.pi * np.maximum(10.0, 4 * rpm / 60.0) * t),
        "alt_current_a": _pink(rng, n, 0.25),
    })
    for k in range(1, 5):
        noise[f"cht_{k}"] = np.zeros(n)
    return noise


def apply_sensor_fault(values: np.ndarray, fault: Optional[dict], rng: np.random.Generator) -> np.ndarray:
    """Corrupt one channel's reading. fault = {mode, onset_s, magnitude}."""
    if not fault:
        return values
    v = values.copy()
    n = len(v)
    k0 = int(np.clip(fault["onset_s"], 0, n - 1))
    mag = float(fault.get("magnitude", 0.0))
    mode = fault["mode"]
    if mode == "bias":
        v[k0:] += mag
    elif mode == "drift":
        v[k0:] += mag * np.arange(n - k0) / max(1, n - k0 - 1)  # reaches `magnitude` at end of sortie
    elif mode == "stuck":
        v[k0:] = v[k0]
    elif mode == "dropout":
        drop = rng.random(n - k0) < 0.25
        v[k0:][drop] = 0.0
    elif mode == "spike":
        idx = k0 + rng.choice(n - k0, size=min(8, n - k0), replace=False)
        v[idx] += mag
    return v


def simulate_telemetry(ctx: Dict[str, np.ndarray], theta, rng: np.random.Generator,
                       engine_bias: Optional[Dict[str, float]] = None,
                       sensor_fault: Optional[dict] = None, mismatch: Optional[dict] = None) -> Dict[str, np.ndarray]:
    """One sortie of 1 Hz telemetry: health-degraded physics -> dynamics -> noise -> ADC -> sensor fault."""
    tgt = steady_state(ctx["throttle_pct"], ctx["alt_m"], ctx["oat_c"], ctx["ias_kt"], ctx["phase"], theta, mismatch)
    if engine_bias:
        for ch, b in engine_bias.items():
            tgt[ch] = tgt[ch] + b
        egts = np.stack([tgt[f"egt_{k + 1}"] for k in range(4)])
        chts = derived_cht(tgt["coolant_temp_c"], tgt["fuel_flow_lph"], egts)
        for k in range(4):
            tgt[f"cht_{k + 1}"] = chts[k]
    dyn = apply_dynamics(tgt)
    n = len(ctx["throttle_pct"])
    noise = sensor_noise(rng, n, dyn["rpm"])
    out = {}
    for ch in SENSOR_CHANNELS:
        v = dyn[ch] + noise[ch]
        if "press" in ch or "flow" in ch or ch in ("rpm", "vib_rms_g", "map_kpa", "alt_current_a"):
            v = np.maximum(0.0, v)
        lsb = ADC_LSB.get(ch, 0.01)
        out[ch] = np.round(v / lsb) * lsb
    if sensor_fault:
        ch = sensor_fault["channel"]
        out[ch] = apply_sensor_fault(out[ch], sensor_fault, rng)
    return out


def mismatch_spec(engine_id: str, rel: float = 0.15) -> dict:
    """Per-engine 'true physics' that differs from the twin's: coefficients x U(1-rel, 1+rel), plus
    throttle-dependent nominal errors (degC or unit per unit of throttle fraction)."""
    rng = np.random.default_rng(int(engine_id.split("-")[1]) + 991)
    coef = {k: v * float(rng.uniform(1 - rel, 1 + rel)) for k, v in COEF.items()}
    nominal = {f"egt_{c}": float(rng.normal(0, 15)) for c in range(1, 5)}
    nominal.update({"oil_temp_c": float(rng.normal(0, 3)), "coolant_temp_c": float(rng.normal(0, 3)),
                    "map_kpa": float(rng.normal(0, 3)), "fuel_flow_lph": float(rng.normal(0, 1)),
                    "rpm": float(rng.normal(0, 60)), "oil_press_bar": float(rng.normal(0, 0.15))})
    return {"coef": coef, "nominal": nominal}
