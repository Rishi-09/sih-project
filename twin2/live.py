"""
Live mode: the twin running against streaming telemetry.

retribution/server_ops feeds every 20 Hz frame to LiveTwin.observe(); every few
simulated seconds it calls assess() on a snapshot (off the simulation thread).
assess() runs the same models as the fleet pipeline, adapted to a rolling window:

  M1  shape rules on the 1 Hz trace, then the engine-vs-sensor hypothesis test
  M2  8 health factors fitted to the window with the DYNAMIC model - targets from
      the physics, passed through the engine's own thermal/hydraulic lags, with the
      slow lags started from the observed readings. So the fit works in climbs and
      power changes, not only in steady cruise.
  M4  per-cylinder EGT split, net of the healthy model (design offsets removed)
  M5  seconds to a thermal redline if the current power is held; hot-day take-off margin
  M6  top-3 causes with a first maintenance check

Output is a superset of the old ML `ml_result` (health_score, subsystem_scores,
fault_type, probabilities, anomaly, remaining_useful_life), so server/opsClient.ts
keeps working, plus `twin` (the physics evidence), `nominal` and `residual_z`.

Health is not learned per engine here (no L1): the live simulator is a single
engine with no build scatter, so its baseline is the model's nominal.
"""

import math
import time
from typing import Dict, List, Optional, Sequence

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

from .catalog import ENGINE_FAULTS
from .models.m1_trust import MIN_SENSOR_Z, SensorFault, _classify_residual, shape_rules
from .models.m2_health import LOWER, PRIOR_SD, UPPER
from .models.m4_m5_m6 import (THERMAL_CHANNELS, diagnose, hot_takeoff_margins, time_to_limit)
from .physics import (FIT_CHANNELS, HF_FAIL, HF_HEALTHY, HF_LABEL, HF_NAMES, NON_THERMAL_TAU, THERMAL_TAU,
                      apply_health, first_order_lag, health_deficit, nominal_targets)

WINDOW_S = 90           # rolling window the fit sees. Health is held constant across it, so it must be
                        # short enough that a fault that just developed soon fills it (the fault ramp is 30 s)
MIN_WINDOW_S = 75       # airborne seconds needed before the first assessment
BURN_S = 20             # fast lags start at their target; give them this long before scoring
BLOCK_S = 15            # residuals are averaged into blocks of this many seconds
MAX_BUFFER_S = 1800
GROUND_PHASES = {"STARTUP", "TAXI", "SHUTDOWN"}
CONTEXT_COLS = ["throttle_pct", "alt_m", "oat_c", "ias_kt", "phase"]
KEEP_COLS = ["t_s", *CONTEXT_COLS, *FIT_CHANNELS, "cht_1", "cht_2", "cht_3", "cht_4", "vib_extra"]
SLOW_LAG = ("coolant_temp_c", "oil_temp_c")  # started from observed values

# 1 Hz measurement scatter per channel (the simulator's noise + ADC step), and a
# per-block floor for model error (1 Hz vs 20 Hz discretisation, gust aliasing).
# Calibrated on healthy live flights: python -m twin2.live_check --calibrate
SIGMA_1HZ = {"rpm": 7.5, "vib_rms_g": 0.013, "egt_1": 3.6, "egt_2": 3.6, "egt_3": 3.6, "egt_4": 3.6,
             "coolant_temp_c": 0.15, "oil_press_bar": 0.04, "oil_temp_c": 0.13, "map_kpa": 0.32,
             "fuel_flow_lph": 0.22}
BLOCK_FLOOR = {"rpm": 4.0, "vib_rms_g": 0.007, "egt_1": 1.9, "egt_2": 1.9, "egt_3": 1.9, "egt_4": 1.9,
               "coolant_temp_c": 0.07, "oil_press_bar": 0.02, "oil_temp_c": 0.07, "map_kpa": 0.14,
               "fuel_flow_lph": 0.12}

CANDIDATE_Z = 3.0
ENGINE_FLAG = 0.15      # a factor this far toward failure is an engine change
RECENT_BLOCKS = 3       # the "now" part of the window (45 s) used to veto stale conclusions
FRESH_Q_LONG = 2.0      # long-window fit this poor ...
FRESH_Q_RECENT = 1.6    # ... while the recent blocks fit this well = the engine just changed
SENSOR_CONFIRM_S = 60.0 # a residual-based sensor call must persist this long before it is reported: an
                        # engine fault ramping in (30 s) can mimic one until the recent 45 s are clear of
                        # the ramp, i.e. ~60 s after the first misfit. Shape-rule faults are immediate.
ANOMALY_Q = 4.0         # mean squared block z the best explanation leaves behind
OCCAM_W = 40.0          # cost per unit of claimed health deficit, measured from HEALTHY


def _lambda(n_blocks: int) -> float:
    """Cost of declaring a sensor fault. Excluding a channel drops ~n_blocks of chi-square even when
    the channel is fine, so the penalty must exceed that plus a real margin."""
    return 40.0 + 2.0 * n_blocks


def _occam(theta) -> float:
    """Every hypothesis pays for the engine damage it claims. The fit's own prior anchors to the previous
    estimate, so without this "the oil-temperature sensor lies AND the oil circuit is restricted" could tie
    with the simpler "the oil-pressure sensor lies" - one fault should beat two."""
    return OCCAM_W * float(np.sum(health_deficit(theta)))


def _lambda_recent(n_blocks: int) -> float:
    """Same idea over the recent blocks only: fewer residuals, so a smaller penalty."""
    return 15.0 + 2.0 * n_blocks


class LiveTwin:
    def __init__(self):
        self.reset()

    # ── feeding ────────────────────────────────────────────────────────────
    def reset(self):
        self._rows: List[dict] = []
        self._last_t = -math.inf
        self.prior = HF_HEALTHY.copy()
        self.n_assessments = 0
        self._sensor_candidate: Optional[str] = None  # residual-based sensor call awaiting confirmation
        self._candidate_since = 0.0

    def observe(self, frame: dict):
        """Called for every simulator frame; keeps one row per simulated second."""
        t = float(frame.get("t_s", 0.0))
        if t < self._last_t - 1.0:  # simulator was reset underneath us
            self.reset()
        if t < self._last_t + 0.999:
            return
        self._last_t = t
        self._rows.append({k: frame.get(k, 0.0) for k in KEEP_COLS})
        if len(self._rows) > MAX_BUFFER_S:
            del self._rows[: len(self._rows) - MAX_BUFFER_S]

    def snapshot(self) -> pd.DataFrame:
        return pd.DataFrame(self._rows[-(WINDOW_S + 5):])

    # ── model ──────────────────────────────────────────────────────────────
    def assess(self, snap: pd.DataFrame) -> Optional[dict]:
        t0 = time.perf_counter()
        w = _airborne_tail(snap)
        if w is None:
            return None
        ctx = {c: w[c].to_numpy() for c in CONTEXT_COLS}
        thr = ctx["throttle_pct"].astype(float)
        nom = nominal_targets(thr, ctx["alt_m"], ctx["oat_c"], ctx["ias_kt"], ctx["phase"])
        vib_extra = w["vib_extra"].to_numpy(dtype=float) if "vib_extra" in w else np.zeros(len(w))
        nom["vib_rms_g"] = nom["vib_rms_g"] + 0.798 * vib_extra  # storm turbulence: E|N(0, s)| = 0.798 s
        obs = {ch: w[ch].to_numpy(dtype=float) for ch in FIT_CHANNELS}
        y0 = {ch: float(np.mean(obs[ch][:5])) for ch in SLOW_LAG}
        sig_1hz = dict(SIGMA_1HZ)
        sig_1hz["vib_rms_g"] = float(np.hypot(SIGMA_1HZ["vib_rms_g"], 0.6 * float(vib_extra.mean())))
        sigma = np.array([np.hypot(sig_1hz[ch] / math.sqrt(BLOCK_S), BLOCK_FLOOR[ch]) for ch in FIT_CHANNELS])

        def trace(theta) -> Dict[str, np.ndarray]:
            tgt = apply_health(nom, thr, theta)
            out = {}
            for ch in FIT_CHANNELS:
                if ch.startswith("egt"):
                    out[ch] = first_order_lag(tgt[ch], THERMAL_TAU["egt"])
                elif ch in SLOW_LAG:
                    out[ch] = first_order_lag(tgt[ch], THERMAL_TAU[ch], y0[ch])
                else:
                    out[ch] = first_order_lag(tgt[ch], NON_THERMAL_TAU[ch])
            return out

        n = len(w)
        starts = list(range(BURN_S, n - 4, BLOCK_S))
        blocks = [(a, min(n, a + BLOCK_S)) for a in starts if min(n, a + BLOCK_S) - a >= 5]
        recent = list(range(max(0, len(blocks) - RECENT_BLOCKS), len(blocks)))
        recent_row = blocks[recent[0]][0] if blocks else n

        # M1 layer 1: shape rules on the raw trace. Corrupt samples stay masked out of the fit for as
        # long as they are in the window, but a fault is only ACTIVE if its evidence is recent - a
        # repaired sensor stops being reported once it has behaved for RECENT_BLOCKS blocks.
        all_faults, masks, all_excluded = shape_rules(w, trace(self.prior), noise_sigma=sig_1hz)
        faults, excluded = [], []
        for f in all_faults:
            v = obs[f.channel]
            active = (bool(np.ptp(v[-20:]) == 0.0) if f.mode == "stuck"
                      else bool(masks.get(f.channel, np.zeros(n, bool))[recent_row:].any()))
            if f.onset_s is not None:  # shape-rule onsets are row indices; report simulated seconds
                f.onset_s = int(w["t_s"].iloc[min(f.onset_s, n - 1)])
            if active:
                faults.append(f)
                if f.channel in all_excluded:
                    excluded.append(f.channel)
            elif f.channel in all_excluded:  # frozen, then released: drop the frozen stretch from the fit
                same = np.concatenate([[False], np.diff(v) == 0.0])
                masks[f.channel] = masks.get(f.channel, np.zeros(n, bool)) | same
        good = {ch: ~masks[ch] if ch in masks else np.ones(n, bool) for ch in FIT_CHANNELS}

        def block_z(theta) -> np.ndarray:
            tr = trace(theta)
            z = np.full((len(blocks), len(FIT_CHANNELS)), np.nan)
            for j, ch in enumerate(FIT_CHANNELS):
                r = obs[ch] - tr[ch]
                for i, (a, b) in enumerate(blocks):
                    m = good[ch][a:b]
                    if m.sum() >= 5:
                        z[i, j] = r[a:b][m].mean() / sigma[j]
            return z

        def fit(exclude: Sequence[str], rows: Optional[List[int]] = None):
            """Health fit on all blocks, or only `rows` (the recent part). Returns theta, sd, cost, z."""
            use_cols = np.array([ch not in exclude for ch in FIT_CHANNELS])
            use_rows = np.zeros(len(blocks), bool)
            use_rows[rows if rows is not None else slice(None)] = True

            def resid(theta):
                z = block_z(theta)[np.ix_(use_rows, use_cols)]
                z = z[~np.isnan(z)]
                return np.concatenate([z, (theta - self.prior) / PRIOR_SD])

            x0 = np.clip(self.prior, LOWER + 1e-6, UPPER - 1e-6)
            sol = least_squares(resid, x0, bounds=(LOWER, UPPER), x_scale=PRIOR_SD, method="trf", max_nfev=60)
            try:
                sd = np.sqrt(np.clip(np.diag(np.linalg.inv(sol.jac.T @ sol.jac)), 0, None))
            except np.linalg.LinAlgError:
                sd = PRIOR_SD.copy()
            z = block_z(sol.x)
            z[:, ~use_cols] = np.nan
            z[~use_rows, :] = np.nan
            return sol.x, sd, float(2 * sol.cost), z

        def q(z) -> float:
            zz = z[~np.isnan(z)]
            return float(np.mean(zz ** 2)) if zz.size else 0.0

        # M1 layer 2 + M2: engine change vs "sensor X is wrong"
        th_e, sd_e, cost_e, z_e = fit(excluded)
        lam = _lambda(len(blocks))
        cost_e += _occam(th_e)
        hyps = {"engine": cost_e}
        best = (th_e, sd_e, cost_e, z_e, None, 0.0)
        absz = np.abs(z_e)
        cnt = np.sum(~np.isnan(absz), axis=0)
        zbar = np.where(cnt > 0, np.nansum(absz, axis=0) / np.maximum(cnt, 1), 0.0)
        for i in [k for k in np.argsort(-zbar) if zbar[k] > CANDIDATE_Z][:3]:
            ch = FIT_CHANNELS[i]
            if ch in excluded:
                continue
            th_s, sd_s, cost_s, z_s = fit(excluded + [ch])
            tr = trace(th_s)
            zc = []
            for a, b in blocks:
                m = good[ch][a:b]
                if m.sum() >= 5:
                    zc.append((obs[ch][a:b][m] - tr[ch][a:b][m]).mean() / sigma[i])
            c = cost_s + lam + _occam(th_s)
            hyps[f"sensor:{ch}"] = c
            if c < best[2] and zc and float(np.mean(np.abs(zc))) > MIN_SENSOR_Z:
                best = (th_s, sd_s, c, z_s, ch, float(np.mean(np.abs(zc))))
        theta, theta_sd, best_cost, z_best, sensor_ch, sensor_z = best

        # Recent check. Health is held constant across the window, so an engine change that happened
        # INSIDE it (a fault ramping in, or a repair) cannot be fitted end to end, and dropping the
        # channel that moved most can look like a lying sensor. A lying sensor disagrees in the recent
        # blocks too; an engine change that has finished is explained there by the engine alone.
        th_r, sd_r, cost_r, z_r = fit(excluded, rows=recent)
        if sensor_ch is not None:
            _, _, cost_rs, _ = fit(excluded + [sensor_ch], rows=recent)
            if cost_rs + _lambda_recent(len(recent)) >= cost_r:
                hyps["engine (recent)"] = cost_r
                theta, theta_sd, z_best, sensor_ch = th_r, sd_r, z_r, None
        if sensor_ch is None and q(z_best) > FRESH_Q_LONG and q(z_r) < FRESH_Q_RECENT:
            # The window straddles a change and the recent blocks fit cleanly: report the engine as it is now.
            theta, theta_sd, z_best = th_r, sd_r, z_r
            hyps["engine (recent)"] = cost_r

        # A residual-based sensor call must hold for SENSOR_CONFIRM_S simulated seconds before it is
        # reported. For the first half-minute after a sudden change, "that sensor is lying" and "the
        # engine just changed" are genuinely hard to tell apart (a ramping fault cannot be fitted by
        # constant health), and those misfits come and go; a lying sensor keeps disagreeing. Meanwhile
        # health comes from the fit WITHOUT the suspect channel, so the engine change is still the
        # headline and a sensor that really is lying never contaminates the estimate.
        t_now = float(w["t_s"].iloc[-1])
        if sensor_ch is None or sensor_ch != self._sensor_candidate:
            self._sensor_candidate, self._candidate_since = sensor_ch, t_now
        confirmed = sensor_ch is not None and t_now - self._candidate_since >= SENSOR_CONFIRM_S
        if sensor_ch is not None and confirmed:
            tr = trace(theta)
            r = (obs[sensor_ch] - tr[sensor_ch])[BURN_S:]
            mode, k = _classify_residual(r, np.arange(len(r), dtype=float))
            conf = float(1.0 / (1.0 + math.exp(-(cost_e - best_cost) / 15.0)))
            faults.append(SensorFault(sensor_ch, mode, round(conf, 3), int(w["t_s"].iloc[BURN_S + k]),
                                      f"disagrees with the physics prediction from the other channels by "
                                      f"{sensor_z:.1f} sigma"))
        self.prior = theta
        self.n_assessments += 1

        # Healthy-engine reference: what a sound engine would read right now (nominal, residual_z, M4, M6 signature)
        tr_h = trace(HF_HEALTHY)
        distrusted = [f.channel for f in faults]
        last = slice(max(BURN_S, n - BLOCK_S), n)
        nominal, residual_z, raw = {}, {}, {}
        for j, ch in enumerate(FIT_CHANNELS):
            nominal[ch] = round(float(tr_h[ch][-1]), 3)
            m = good[ch][last]
            if m.sum():
                residual_z[ch] = round(float((obs[ch][last][m] - tr_h[ch][last][m]).mean() / sigma[j]), 2)
            if ch not in distrusted:
                m2 = good[ch][BURN_S:]
                raw[ch] = float((obs[ch][BURN_S:][m2] - tr_h[ch][BURN_S:][m2]).mean() / sigma[j])
        egts = [raw[f"egt_{k}"] for k in range(1, 5) if f"egt_{k}" in raw]
        if egts:
            raw["egt_mean"] = float(np.mean(egts))

        # M4: EGT split net of the healthy model, so design offsets and operating point cancel
        res_egt = {}
        for k in range(1, 5):
            ch = f"egt_{k}"
            if ch not in distrusted:
                m = good[ch][BURN_S:]
                res_egt[k] = float((obs[ch][BURN_S:][m] - tr_h[ch][BURN_S:][m]).mean())
        cyl_dev: List[Optional[float]] = []
        for k in range(1, 5):
            others = [v for kk, v in res_egt.items() if kk != k]
            cyl_dev.append(round(res_egt[k] - float(np.mean(others)), 1) if k in res_egt and others else None)

        # M6
        dx = diagnose(theta, theta_sd, np.zeros(len(HF_NAMES)), cyl_dev, [0.0] * 4, faults, raw)
        d = health_deficit(theta)
        comb = [HF_NAMES.index(f"comb_{k}") for k in range(1, 5)]
        weak_cyl = int(np.argmax(d[comb])) + 1
        causes = []
        for c in dx["causes"]:
            key = f"weak_cylinder_cyl{weak_cyl}" if c["id"] == "weak_cylinder" else c["id"]
            causes.append({**c, "id": key})

        # M5: at the power being flown now, from the latest readings
        now = w.iloc[-5:]
        current = {ch: float(now[ch].mean()) for ch in THERMAL_CHANNELS if ch in now and ch not in distrusted}
        ctx_now = w.iloc[-1]
        ttl = time_to_limit(theta, current, float(ctx_now["throttle_pct"]), float(ctx_now["alt_m"]),
                            float(ctx_now["oat_c"]), float(ctx_now["ias_kt"]), str(ctx_now["phase"]))
        finite = {ch: v for ch, v in ttl.items() if v is not None}
        rul_ch = min(finite, key=lambda c: finite[c]) if finite else None
        hot = hot_takeoff_margins(theta)
        hot_ch = max(hot, key=lambda c: hot[c] / abs(_limit(c)))

        # Anomaly: what the chosen explanation still cannot explain
        return _result(theta, theta_sd, d, faults, causes, dx["no_fault"], hyps, cyl_dev, finite, rul_ch,
                       hot, hot_ch, q(z_best), nominal, residual_z, n, len(blocks),
                       round(1000 * (time.perf_counter() - t0)), int(w["t_s"].iloc[-1]))


# ── helpers ────────────────────────────────────────────────────────────────

def _limit(ch: str) -> float:
    from .physics import REDLINE
    return REDLINE[ch]


def _airborne_tail(snap: pd.DataFrame) -> Optional[pd.DataFrame]:
    """The last WINDOW_S seconds since the engine was last on the ground, or None if too short."""
    if snap is None or snap.empty:
        return None
    phase = snap["phase"].astype(str).str.upper().to_numpy()
    ground = np.where(np.isin(phase, list(GROUND_PHASES)))[0]
    start = int(ground[-1]) + 1 if len(ground) else 0
    w = snap.iloc[start:]
    if len(w) < MIN_WINDOW_S:
        return None
    return w.iloc[-WINDOW_S:].reset_index(drop=True)


SUBSYSTEM_FACTORS = {
    "lubrication": ["oil_res"],
    "cooling": ["cool_eff"],
    "combustion": ["comb_1", "comb_2", "comb_3", "comb_4"],
    "injection": ["comb_1", "comb_2", "comb_3", "comb_4"],
    "mechanical": ["comb_1", "comb_2", "comb_3", "comb_4"],
    "induction": ["ve", "eta_turbo"],
    "fuel": ["ve"],
}


def _result(theta, theta_sd, d, faults: List[SensorFault], causes, no_fault, hyps, cyl_dev, ttl, rul_ch,
            hot, hot_ch, q, nominal, residual_z, n_s, n_blocks, ms, t_s) -> dict:
    def score(names):
        return round(100.0 * float(np.clip(1.0 - max(d[HF_NAMES.index(x)] for x in names), 0.0, 1.0)), 1)

    subsystems: Dict[str, Optional[float]] = {k: score(v) for k, v in SUBSYSTEM_FACTORS.items()}
    subsystems["electrical"] = None  # the physics twin does not model the electrical system
    health = round(100.0 * float(np.clip(1.0 - d.max(), 0.0, 1.0)), 1)

    probs = {"healthy": float(no_fault)}
    for c in causes:
        probs[c["id"]] = float(c["score"])
    # Headline: a real engine change outranks a distrusted sensor, which is still reported beside it
    # (twin.sensor_faults, and DiagnosisBlock.sensorFault on the server).
    engine_causes = [c for c in causes if c["id"] != "sensor_fault"]
    if engine_causes and d.max() > ENGINE_FLAG:
        top = engine_causes[0]["id"]
    else:
        top = causes[0]["id"] if causes else "healthy"
    fault_type = top if causes and probs[top] > probs["healthy"] else "healthy"

    attribution = ("both" if faults and d.max() > ENGINE_FLAG else "sensor" if faults
                   else "engine" if d.max() > ENGINE_FLAG else "none")
    factors = [{"name": nme, "label": HF_LABEL[nme], "value": round(float(theta[i]), 4),
                "sd": round(float(theta_sd[i]), 4), "deficit": round(float(d[i]), 4),
                "healthy": float(HF_HEALTHY[i]), "fail": float(HF_FAIL[i])}
               for i, nme in enumerate(HF_NAMES)]
    rul = round(float(ttl[rul_ch]), 1) if rul_ch else None
    anomaly_score = float(np.clip((q - 1.0) / 9.0, 0.0, 1.0))
    explanations = {
        "health_overall": f"Worst health factor is {HF_LABEL[HF_NAMES[int(np.argmax(d))]]} at "
                          f"{100 * d.max():.0f}% of the way to failure.",
        "diagnosed_fault": (f"{causes[0]['label']}: {causes[0]['check']}" if causes else "No fault indicated."),
        "sensor_trust": ("; ".join(f"{f.channel} {f.mode}" for f in faults) or "all channels agree with the twin"),
    }
    return {
        # --- the old ml_result contract, so every existing consumer keeps working ---
        "health_score": health,
        "subsystem_scores": subsystems,
        "fault_type": fault_type,
        "confidence": round(probs.get(fault_type, 0.0), 4),
        "anomaly": bool(q > ANOMALY_Q),
        "anomaly_score": round(anomaly_score, 4),
        "remaining_useful_life": rul,
        "probabilities": {k: round(v, 4) for k, v in probs.items()},
        "explanations": explanations,
        # --- new ---
        "model": "twin2-live",
        "nominal": nominal,
        "residual_z": residual_z,
        "twin": {
            "factors": factors,
            "attribution": attribution,
            "sensor_faults": [{"channel": f.channel, "mode": "frozen" if f.mode == "stuck" else f.mode,
                               "confidence": f.confidence, "onset_s": f.onset_s, "evidence": f.evidence}
                              for f in faults],
            "causes": causes,
            "no_fault": round(float(no_fault), 4),
            "hypotheses": {k: round(v, 1) for k, v in sorted(hyps.items(), key=lambda kv: kv[1])},
            "cyl_dev": cyl_dev,
            "time_to_limit": {k: round(v, 1) for k, v in ttl.items()},
            "limiting_channel": rul_ch,
            "hot_takeoff": {"channel": hot_ch, "margin": round(float(hot[hot_ch]), 2)},
            "unexplained": round(q, 2),
            "window_s": n_s,
            "blocks": n_blocks,
            "compute_ms": ms,
            "t_s": t_s,
        },
    }


ENGINE_FAULT_IDS = list(ENGINE_FAULTS)
