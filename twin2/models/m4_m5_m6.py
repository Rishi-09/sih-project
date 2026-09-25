"""
M4-lite  cylinder split: each cylinder's EGT against the mean of the other three.
M5-lite  thermal time-to-limit: forward-simulate the fitted engine (M2) at a power setting.
M6-lite  root cause: rule table from evidence (M1 trust, M2 factors and trends, M4
         split, raw residual signatures) to ranked causes, each with a first check.
"""

from typing import Dict, List, Optional, Sequence

import numpy as np

from ..physics import (FIT_CHANNELS, HF_FAIL, HF_HEALTHY, HF_NAMES, REDLINE, THERMAL_TAU,
                       health_deficit, steady_state)

EGT_IDX = [FIT_CHANNELS.index(f"egt_{k}") for k in range(1, 5)]


# ── M4 ──────────────────────────────────────────────────────────────────────

def cylinder_split(seg_obs: np.ndarray, valid: np.ndarray, bias: np.ndarray,
                   distrusted: Sequence[str]) -> List[Optional[float]]:
    """dev_k = EGT_k - mean(other trusted EGTs), build offsets removed, averaged over steady segments (degC)."""
    egts = seg_obs[:, EGT_IDX] - bias[EGT_IDX][None, :]
    ok = valid[:, EGT_IDX].copy()
    for k in range(4):
        if f"egt_{k + 1}" in distrusted:
            ok[:, k] = False
    egts = np.where(ok, egts, np.nan)
    out = []
    for k in range(4):
        if not ok[:, k].any():
            out.append(None)
            continue
        others = np.delete(egts, k, axis=1)
        dev = egts[:, k] - np.nanmean(others, axis=1)
        out.append(float(np.nanmean(dev)))
    return out


def cylinder_trend(history: List[List[Optional[float]]], ages: List[float], window: int = 10):
    """Per-cylinder split slope (degC per 100 h) over the last `window` sorties."""
    h = np.array([[np.nan if v is None else v for v in row] for row in history[-window:]], float)
    a = np.array(ages[-window:], float)
    slopes = []
    for k in range(4):
        m = ~np.isnan(h[:, k])
        if m.sum() < 4 or np.ptp(a[m]) < 1:
            slopes.append(0.0)
            continue
        slopes.append(float(np.polyfit(a[m], h[m, k], 1)[0] * 100.0))
    return slopes


# ── M5 ──────────────────────────────────────────────────────────────────────

THERMAL_CHANNELS = ["coolant_temp_c", "oil_temp_c", "cht_1", "cht_2", "cht_3", "cht_4",
                    "egt_1", "egt_2", "egt_3", "egt_4"]
# Worst-case reference condition for "how long until this engine cannot do a hot-day take-off"
HOT_TAKEOFF_OAT_C = 40.0


def hot_takeoff_margins(theta) -> Dict[str, float]:
    """Steady-state margins at full power, sea level, 40 degC: the worst case a sortie starts with."""
    return steady_margins(theta, 100.0, 0.0, HOT_TAKEOFF_OAT_C, 65.0, "TAKEOFF")


def steady_margins(theta, throttle_pct, alt_m, oat_c, ias_kt=80.0, phase="CRUISE") -> Dict[str, float]:
    """Steady-state value minus redline for each thermal channel (positive = over the limit)."""
    ss = steady_state(np.array([throttle_pct]), np.array([alt_m]), np.array([oat_c]),
                      np.array([ias_kt]), np.array([phase]), theta)
    out = {ch: float(ss[ch][0] - REDLINE[ch]) for ch in THERMAL_CHANNELS if ch in REDLINE}
    out["oil_press_bar"] = float(REDLINE["oil_press_bar"] - ss["oil_press_bar"][0])  # low limit
    return out


def time_to_limit(theta, current: Dict[str, float], throttle_pct, alt_m, oat_c, ias_kt=80.0, phase="CRUISE"):
    """
    Seconds until each thermal channel reaches its redline if held at this power.
    First-order approach T(t) = Tss + (T0 - Tss) e^(-t/tau) (the thermal network's own time constants).
    None when the steady state stays below the limit.
    """
    ss = steady_state(np.array([throttle_pct]), np.array([alt_m]), np.array([oat_c]),
                      np.array([ias_kt]), np.array([phase]), theta)
    out = {}
    for ch in THERMAL_CHANNELS:
        tss, lim = float(ss[ch][0]), REDLINE[ch]
        t0 = current.get(ch, tss)
        tau = THERMAL_TAU["egt"] if ch.startswith("egt") else THERMAL_TAU["cht"] if ch.startswith("cht") \
            else THERMAL_TAU[ch]
        if t0 >= lim:
            out[ch] = 0.0
        elif tss <= lim:
            out[ch] = None
        else:
            out[ch] = float(-tau * np.log((tss - lim) / (tss - t0)))
    return out


def factor_trend(thetas: np.ndarray, ages: np.ndarray, window: int = 10):
    """Per-factor slope (per hour) and current level from a robust linear fit over recent sorties."""
    th, a = thetas[-window:], ages[-window:]
    if len(a) < 4 or np.ptp(a) < 1:
        return np.zeros(thetas.shape[1]), thetas[-1]
    slope = np.array([np.polyfit(a, th[:, i], 1)[0] for i in range(th.shape[1])])
    level = np.array([np.polyval(np.polyfit(a, th[:, i], 1), a[-1]) for i in range(th.shape[1])])
    return slope, level


def hours_to_thermal_limit(level, slope, horizon_h: float = 1500.0, step_h: float = 10.0):
    """
    Engine hours until a hot-day take-off would breach a thermal redline, extrapolating
    the health-factor trend. Returns (hours or None, binding channel).
    """
    slope = np.where(np.abs(slope) < 1e-7, 0.0, slope)
    for h in np.arange(0.0, horizon_h + step_h, step_h):
        th = level + slope * h
        th = np.clip(th, 0.2, 3.5)
        m = hot_takeoff_margins(th)
        worst = max(m, key=lambda c: m[c])
        if m[worst] >= 0:
            return float(h), worst
    return None, None


def hours_to_failure_threshold(level, slope, horizon_h: float = 3000.0):
    """Linear extrapolation of each factor to its failure threshold. Returns (hours or None, factor)."""
    best, which = None, None
    for i, n in enumerate(HF_NAMES):
        gap = HF_FAIL[i] - level[i]
        if slope[i] == 0 or np.sign(gap) != np.sign(slope[i]):
            continue
        h = gap / slope[i]
        if 0 <= h <= horizon_h and (best is None or h < best):
            best, which = float(h), n
    return best, which


# ── M6 ──────────────────────────────────────────────────────────────────────

CAUSES = {
    "weak_cylinder": {
        "label": "Weak cylinder (ignition / combustion)",
        "check": "Cylinder {cyl}: inspect spark plugs and both ignition leads, then borescope the cylinder.",
    },
    "turbo_degradation": {
        "label": "Turbocharger degradation",
        "check": "Turbocharger: check shaft play and wheel rub, wastegate actuator travel, "
                 "exhaust leaks upstream of the turbine.",
    },
    "induction_leak": {
        "label": "Induction leak / volumetric efficiency loss",
        "check": "Pressure-test the induction path: hoses, clamps, intercooler and airbox joints.",
    },
    "coolant_restriction": {
        "label": "Coolant circuit restriction",
        "check": "Coolant level and condition, radiator core blockage, pump drive and thermostat.",
    },
    "oil_restriction": {
        "label": "Oil circuit restriction",
        "check": "Oil filter (bypass indicator), pressure relief valve; take an oil sample for debris.",
    },
    "sensor_fault": {
        "label": "Sensor / harness fault",
        "check": "{channel}: inspect harness and connector, swap the probe and re-check against the twin.",
    },
}
FACTOR_CAUSE = {"ve": "induction_leak", "eta_turbo": "turbo_degradation", "oil_res": "oil_restriction",
                "cool_eff": "coolant_restriction", "comb_1": "weak_cylinder", "comb_2": "weak_cylinder",
                "comb_3": "weak_cylinder", "comb_4": "weak_cylinder"}
NONE_SCORE = 0.12  # prior weight on "no fault"; causes must beat it to rank
MIN_CAUSE_SCORE = 0.05  # below this a cause is noise-level and is not listed
CAUSE_MIN_DEFICIT = 0.10  # a factor is only a candidate cause once it is 10% of the way to failure...
CAUSE_MIN_TREND = 0.10    # ...or moving toward it by 10% per 100 h


def signature(seg, bias, sigma, distrusted: Sequence[str]) -> Dict[str, float]:
    """
    Raw evidence independent of the factor fit: highest-power segment residual
    against a HEALTHY engine (z-units), the signature-matrix view.
    """
    from .m2_health import predict  # local import avoids a cycle
    i = int(np.argmax(seg.throttle))
    z = (seg.obs[i] - bias - predict(seg, HF_HEALTHY)[i]) / sigma
    out = {}
    for j, ch in enumerate(FIT_CHANNELS):
        if seg.valid[i, j] and ch not in distrusted:
            out[ch] = float(z[j])
    egts = [out[f"egt_{k}"] for k in range(1, 5) if f"egt_{k}" in out]
    if egts:
        out["egt_mean"] = float(np.mean(egts))
    return out


def diagnose(theta, theta_sd, slope_per_h, cyl_dev, cyl_slope, sensor_faults, raw_z: Dict[str, float]):
    """
    Returns ranked causes: [{id, label, score, evidence[], check}], top-3 plus a no-fault score.
    Scores are relative weights normalised to 1 (not calibrated probabilities).
    """
    d = health_deficit(theta)
    trend_100h = -(slope_per_h / (HF_HEALTHY - HF_FAIL)) * 100.0  # deficit gained per 100 h
    scores: Dict[str, float] = {}
    evidence: Dict[str, List[str]] = {k: [] for k in CAUSES}
    ctx: Dict[str, dict] = {k: {} for k in CAUSES}

    for i, n in enumerate(HF_NAMES):
        cause = FACTOR_CAUSE[n]
        z = (d[i]) / max(1e-3, theta_sd[i] / abs(HF_HEALTHY[i] - HF_FAIL[i]))
        s = d[i] + 0.5 * max(0.0, trend_100h[i])
        if z < 3:  # not distinguishable from noise
            s *= 0.2
        if d[i] < CAUSE_MIN_DEFICIT and trend_100h[i] < CAUSE_MIN_TREND:
            continue  # normal background wear, not a cause
        if cause == "weak_cylinder":
            cyl = int(n[-1])
            dev = cyl_dev[cyl - 1]
            if dev is not None and dev < -10:
                s += 0.15
                evidence[cause].append(f"M4: cyl {cyl} EGT {dev:+.0f} degC vs the others"
                                       + (f", trending {cyl_slope[cyl - 1]:+.1f} degC/100 h" if cyl_slope else ""))
            if s <= scores.get(cause, 0):
                continue
            ctx[cause]["cyl"] = cyl
            evidence[cause] = [e for e in evidence[cause] if f"cyl {cyl}" in e]
        if s > scores.get(cause, 0):
            scores[cause] = s
            evidence[cause].insert(0, f"M2: {n} = {theta[i]:.3f} ({100 * d[i]:.0f}% of the way to failure"
                                      + (f", +{100 * trend_100h[i]:.0f}%/100 h" if trend_100h[i] > 0.01 else "") + ")")

    # signature-matrix corroboration from raw residuals (healthy-engine reference, highest power hold)
    sig_rules = {
        "turbo_degradation": [("map_kpa", -1), ("egt_mean", +1)],
        "induction_leak": [("fuel_flow_lph", -1), ("map_kpa", 0)],
        "coolant_restriction": [("coolant_temp_c", +1), ("oil_temp_c", +1)],
        "oil_restriction": [("oil_press_bar", -1), ("oil_temp_c", +1)],
    }
    for cause, pattern in sig_rules.items():
        hits = 0
        for ch, sign in pattern:
            z = raw_z.get(ch)
            if z is None:
                continue
            if (sign == 0 and abs(z) < 3) or (sign != 0 and sign * z > 4):
                hits += 1
        if hits == len(pattern) and cause in scores:
            scores[cause] += 0.1
            evidence[cause].append("Signature: " + ", ".join(
                f"{ch} {'low' if s < 0 else 'high' if s > 0 else 'normal'}" for ch, s in pattern))

    for f in sensor_faults:
        s = 0.6 * f.confidence + 0.3
        if s > scores.get("sensor_fault", 0):
            scores["sensor_fault"] = s
            ctx["sensor_fault"]["channel"] = f.channel
        evidence["sensor_fault"].append(f"M1: {f.channel} {f.mode} ({f.evidence})")

    scores = {k: v for k, v in scores.items() if v >= MIN_CAUSE_SCORE}
    total = NONE_SCORE + sum(scores.values())
    ranked = []
    for cause, s in sorted(scores.items(), key=lambda kv: -kv[1]):
        c = CAUSES[cause]
        ranked.append({
            "id": cause, "label": c["label"], "score": round(s / total, 3),
            "evidence": evidence[cause][:3],
            "check": c["check"].format(cyl=ctx[cause].get("cyl", "?"), channel=ctx[cause].get("channel", "?")),
        })
    return {"causes": ranked[:3], "no_fault": round(NONE_SCORE / total, 3)}
