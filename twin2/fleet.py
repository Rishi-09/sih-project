"""
Synthetic MALE UAV fleet: 20 engines x 30-60 sorties with slow wear, developing
faults, failures, censoring, per-engine build variation and sensor faults.

Each sortie keeps only its ground truth and a seed. The 1 Hz telemetry is
regenerated on demand (`sortie_telemetry`), deterministically and in a few ms, so
the fleet costs nothing on disk and every consumer sees identical data.

A sortie's telemetry is a ~45-minute representative snippet (take-off, climb,
four steady power holds, descent); its logged `duration_h` is the full mission
length that ages the engine.
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .physics import HF_NAMES, HF_FAIL, HF_HEALTHY, health_deficit, simulate_telemetry

FAULT_TYPES = ["weak_cylinder", "turbo_degradation", "induction_leak", "coolant_restriction", "oil_restriction"]
FAULT_FACTOR = {
    "turbo_degradation": "eta_turbo",
    "induction_leak": "ve",
    "coolant_restriction": "cool_eff",
    "oil_restriction": "oil_res",
    # weak_cylinder -> comb_<cyl>
}
SENSOR_FAULT_CHANNELS = {
    # channel: (min magnitude, max magnitude) for bias/drift/spike
    "egt_1": (40, 90), "egt_2": (40, 90), "egt_3": (40, 90), "egt_4": (40, 90),
    "oil_temp_c": (6, 14), "coolant_temp_c": (5, 12), "oil_press_bar": (0.4, 0.9),
    "map_kpa": (6, 12), "fuel_flow_lph": (2.0, 4.0), "rpm": (150, 300), "vib_rms_g": (0.10, 0.20),
}
SENSOR_FAULT_MODES = ["bias", "drift", "stuck", "dropout", "spike"]
HOLD_S = 300          # each steady power hold
STEADY_TAIL_S = 150   # last part of a hold used as a steady segment (thermal lags settled)
TBO_H = 2000.0
N_ENGINES = 20


# ── Sortie profile ──────────────────────────────────────────────────────────

def sortie_context(mission: dict, rng: np.random.Generator):
    """1 Hz flight context plus the steady segments M2 fits on."""
    alt_t = mission["alt_m"]
    holds = mission["holds"]  # throttle % of the four steady holds
    # (phase, seconds, throttle %, IAS kt, altitude m or None = ramp)
    legs: List[Tuple[str, int, float, float, Optional[float]]] = [
        ("STARTUP", 30, 3, 0, 0), ("TAXI", 60, 12, 10, 0), ("TAKEOFF", 40, 100, 65, 0)]
    climb_s = int(alt_t / 6.0)
    legs.append(("CLIMB", climb_s, 90, 75, None))
    for i, h in enumerate(holds):
        legs.append(("CRUISE" if i < 2 else "LOITER", HOLD_S, h, 90 if i < 2 else 75, alt_t))
    descent_s = int(alt_t / 5.0)
    legs += [("DESCENT", descent_s, 25, 85, None), ("APPROACH", 60, 30, 65, 0), ("SHUTDOWN", 30, 0, 0, 0)]

    thr, alt, ias, ph, segs = [], [], [], [], []
    t = 0
    for name, dur, u, v, a in legs:
        if name == "CLIMB":
            alts = np.linspace(0.0, alt_t, dur)
        elif name == "DESCENT":
            alts = np.linspace(alt_t, 0.0, dur)
        else:
            alts = np.full(dur, float(a or 0.0))
        jitter = rng.normal(0, 0.4, dur).cumsum() * 0.05 if name in ("CRUISE", "LOITER") else np.zeros(dur)
        thr.append(np.clip(u + jitter, 0, 100))
        alt.append(alts)
        ias.append(np.full(dur, float(v)) + (rng.normal(0, 0.8, dur) if v else 0))
        ph += [name] * dur
        if name in ("CRUISE", "LOITER"):
            segs.append((t + HOLD_S - STEADY_TAIL_S, t + HOLD_S))
        t += dur
    alt = np.concatenate(alt)
    oat = mission["oat_sl_c"] - 6.5 * alt / 1000.0
    ctx = {
        "t_s": np.arange(t, dtype=float),
        "throttle_pct": np.concatenate(thr),
        "alt_m": alt,
        "oat_c": oat,
        "ias_kt": np.concatenate(ias),
        "phase": np.array(ph),
    }
    return ctx, segs


# ── Fleet ground truth ──────────────────────────────────────────────────────

@dataclass
class DevelopingFault:
    kind: str
    factor: str
    onset_h: float          # engine age (h since overhaul) at onset
    t_fail_stress_h: float  # stress-weighted hours from onset to the failure threshold
    stress_h: float = 0.0


@dataclass
class EngineSpec:
    engine_id: str
    serial: str
    age0_h: float
    stress_power: float     # typical loiter throttle fraction of this engine's missions
    n_sorties: int
    bias: Dict[str, float]
    faults: List[DevelopingFault] = field(default_factory=list)
    scripted: str = ""


def _stress(power_frac: float) -> float:
    """Wear-rate multiplier from mission power: 1.0 at 60% loiter power."""
    return float(np.exp(4.0 * (power_frac - 0.60)))


def _theta_at(spec: EngineSpec, age_h: float, wear_h: float) -> np.ndarray:
    """True health factors: background wear plus developing faults."""
    theta = HF_HEALTHY.copy()
    # background wear: ~3-6% of the way to failure per 1000 stress-hours
    bg = np.array([0.03, 0.05, 0.03, 0.03, 0.03, 0.03, 0.04, 0.03]) * wear_h / 1000.0
    theta = theta + bg * (HF_FAIL - HF_HEALTHY)
    for f in spec.faults:
        if f.stress_h <= 0:
            continue
        d = (f.stress_h / f.t_fail_stress_h) ** 1.6
        i = HF_NAMES.index(f.factor)
        theta[i] = theta[i] + d * (HF_FAIL[i] - HF_HEALTHY[i])
    return theta


def _new_fault(rng, kind: str, onset_h: float, t_fail: float) -> DevelopingFault:
    factor = FAULT_FACTOR.get(kind) or f"comb_{int(rng.integers(1, 5))}"
    return DevelopingFault(kind, factor, onset_h, t_fail)


def build_engines(seed: int = 7) -> List[EngineSpec]:
    rng = np.random.default_rng(seed)
    engines = []
    for e in range(N_ENGINES):
        eid = f"UAV-{e + 1:02d}"
        bias = {f"egt_{k}": float(rng.normal(0, 10)) for k in range(1, 5)}
        bias.update({"oil_press_bar": float(rng.normal(0, 0.12)), "coolant_temp_c": float(rng.normal(0, 1.5)),
                     "oil_temp_c": float(rng.normal(0, 1.5)), "map_kpa": float(rng.normal(0, 0.8))})
        spec = EngineSpec(
            engine_id=eid, serial=f"E915-{4100 + 37 * e}",
            age0_h=float(rng.uniform(0, 700)), stress_power=float(rng.uniform(0.50, 0.70)),
            n_sorties=int(rng.integers(30, 61)), bias=bias,
        )
        r = rng.random()
        n_faults = 0 if r < 0.30 else (1 if r < 0.85 else 2)
        for _ in range(n_faults):
            kind = str(rng.choice(FAULT_TYPES))
            onset = spec.age0_h + float(rng.uniform(60, 500))
            spec.faults.append(_new_fault(rng, kind, onset, float(rng.uniform(120, 450))))
        engines.append(spec)

    # Scripted demo engines (plan B5 demo script) — deterministic stories on top of the random fleet
    def script(eid, **kw):
        s = next(x for x in engines if x.engine_id == eid)
        for k, v in kw.items():
            setattr(s, k, v)
        return s

    script("UAV-03", age0_h=300.0, n_sorties=48, stress_power=0.62, scripted="turbo degradation (slow)",
           faults=[DevelopingFault("turbo_degradation", "eta_turbo", 380.0, 740.0)])
    script("UAV-07", age0_h=150.0, n_sorties=44, stress_power=0.58, scripted="cylinder 3 separating",
           faults=[DevelopingFault("weak_cylinder", "comb_3", 260.0, 900.0)])
    script("UAV-11", age0_h=420.0, n_sorties=40, stress_power=0.55, scripted="EGT-2 thermocouple drift on sortie 20",
           faults=[])
    script("UAV-05", age0_h=40.0, n_sorties=36, stress_power=0.52, scripted="healthy, low hours", faults=[])
    return engines


def build_fleet(seed: int = 7):
    """Returns (engines, sorties DataFrame). One row per sortie with all ground truth."""
    engines = build_engines(seed)
    rng = np.random.default_rng(seed + 1)
    rows = []
    for spec in engines:
        age = spec.age0_h
        wear = 0.0
        for s in range(spec.n_sorties):
            power = float(np.clip(spec.stress_power + rng.normal(0, 0.04), 0.40, 0.80))
            dur = float(rng.uniform(8, 22))
            mission = {
                "alt_m": float(rng.uniform(2500, 4200)),
                "oat_sl_c": float(rng.uniform(5, 40)),
                "holds": [80.0, 70.0, round(100 * power, 1), 50.0],
            }
            theta_start = _theta_at(spec, age, wear)

            # sensor faults: scripted one + ~7% random
            sfault = None
            if spec.engine_id == "UAV-11" and s == 19:
                sfault = {"channel": "egt_2", "mode": "drift", "magnitude": 85.0, "onset_frac": 0.15}
            elif rng.random() < 0.07:
                ch = str(rng.choice(list(SENSOR_FAULT_CHANNELS)))
                lo, hi = SENSOR_FAULT_CHANNELS[ch]
                mode = str(rng.choice(SENSOR_FAULT_MODES))
                sign = 1.0 if (mode == "spike" or rng.random() < 0.5) else -1.0
                sfault = {"channel": ch, "mode": mode, "magnitude": sign * float(rng.uniform(lo, hi)),
                          "onset_frac": float(rng.uniform(0.1, 0.5))}

            # advance wear through this sortie
            st = _stress(power)
            for f in spec.faults:
                if age + dur > f.onset_h:
                    f.stress_h += (age + dur - max(age, f.onset_h)) * st
            wear += dur * st
            theta_end = _theta_at(spec, age + dur, wear)
            d_end = health_deficit(theta_end)
            failed = bool(d_end.max() >= 1.0)
            fail_factor = HF_NAMES[int(d_end.argmax())] if failed else ""
            # rare random (non-wear) failure
            if not failed and rng.random() < 1.0 - np.exp(-dur * st / 9000.0):
                failed, fail_factor = True, "random"
            if failed and fail_factor not in ("", "random"):
                fail_kind = next((f.kind for f in spec.faults if f.factor == fail_factor), "wear-out")
            else:
                fail_kind = fail_factor

            active = [f.kind + (f"@{f.factor}" if f.kind == "weak_cylinder" else "")
                      for f in spec.faults if f.stress_h > 0]
            row = {
                "engine_id": spec.engine_id, "sortie": s, "seed": int(seed * 100000 + hash_id(spec.engine_id) * 100 + s),
                "age_h": age, "duration_h": dur, "power": power, "stress": st,
                "alt_m": mission["alt_m"], "oat_sl_c": mission["oat_sl_c"], "holds": mission["holds"],
                "active_faults": ";".join(active),
                "sf_channel": sfault["channel"] if sfault else "", "sf_mode": sfault["mode"] if sfault else "",
                "sf_magnitude": sfault["magnitude"] if sfault else 0.0,
                "sf_onset_frac": sfault["onset_frac"] if sfault else 0.0,
                "failed": failed, "failure_kind": fail_kind,
                "true_deficit_max": float(health_deficit(theta_start).max()),
            }
            for i, n in enumerate(HF_NAMES):
                row[f"true_{n}"] = float(theta_start[i])
            rows.append(row)
            age += dur
            if failed or age >= TBO_H:
                break
    sorties = pd.DataFrame(rows)
    return engines, sorties


def hash_id(engine_id: str) -> int:
    return int(engine_id.split("-")[1])


def sortie_telemetry(row, engine: EngineSpec, mismatch: Optional[dict] = None) -> pd.DataFrame:
    """Regenerate one sortie's 1 Hz telemetry deterministically from its ground-truth row."""
    rng = np.random.default_rng(int(row["seed"]))
    mission = {"alt_m": row["alt_m"], "oat_sl_c": row["oat_sl_c"], "holds": list(row["holds"])}
    ctx, segs = sortie_context(mission, rng)
    theta = np.array([row[f"true_{n}"] for n in HF_NAMES])
    sfault = None
    if row["sf_channel"]:
        sfault = {"channel": row["sf_channel"], "mode": row["sf_mode"], "magnitude": row["sf_magnitude"],
                  "onset_s": int(row["sf_onset_frac"] * len(ctx["t_s"]))}
    tel = simulate_telemetry(ctx, theta, rng, engine_bias=engine.bias, sensor_fault=sfault, mismatch=mismatch)
    df = pd.DataFrame({**ctx, **tel})
    df.attrs["segments"] = segs
    return df


def engines_table(engines: List[EngineSpec]) -> pd.DataFrame:
    rows = []
    for e in engines:
        d = asdict(e)
        d["faults"] = ";".join(f"{f.kind}@{f.factor}" for f in e.faults)
        d.pop("bias")
        rows.append(d)
    return pd.DataFrame(rows)
