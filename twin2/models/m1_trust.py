"""
M1-lite: signal trust — is an anomaly the SENSOR or the ENGINE?

Two layers:

1. Fault-shape rules on the raw 1 Hz trace: dropout (zeros while running),
   stuck (identical readings through a period where the physics says the value
   had to move), spike (isolated jumps far outside the channel's own
   second-to-second scatter). Dropout and spike samples are masked, so the
   channel stays usable. A stuck channel is excluded from the fit.

2. Hypothesis test against the physics twin (M2). A real engine change moves
   several channels together, in the ratios the physics dictates (a weak
   cylinder drops its EGT and raises vibration and RPM droop together). A lying
   sensor moves one channel alone. So:

       H_engine    : every trusted channel is right, health factors are free
       H_sensor(c) : channel c is wrong (excluded), health factors are free

   Each hypothesis is fitted and scored by residual cost. H_sensor pays a fixed
   penalty LAMBDA (it spends a degree of freedom). The cheapest explanation wins.
   A sensor call also requires the excluded channel to disagree strongly with
   the physics prediction built from all the other channels. That prediction is
   the physics "virtual sensor".
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from ..physics import ADC_LSB, FIT_CHANNELS, health_deficit
from .m2_health import HealthFit, SortieSegments, fit, model_trace, predict, prepare

LAMBDA = 40.0            # cost penalty for declaring a sensor fault (~6 sigma)
MIN_SENSOR_Z = 5.0       # excluded channel must disagree by this many sigma on average
CANDIDATE_Z = 3.0        # channels worth testing under H_sensor
ENGINE_DEFICIT_FLAG = 0.15
SPIKE_FLOOR = {"egt": 25.0, "oil_temp_c": 4.0, "coolant_temp_c": 4.0, "oil_press_bar": 0.3,
               "map_kpa": 4.0, "fuel_flow_lph": 1.5, "rpm": 100.0, "vib_rms_g": 0.08}


@dataclass
class SensorFault:
    channel: str
    mode: str                # bias | drift | stuck | dropout | spike
    confidence: float
    onset_s: Optional[int]
    evidence: str


@dataclass
class TrustResult:
    sensor_faults: List[SensorFault]
    health: HealthFit
    engine_anomaly: bool
    attribution: str         # none | sensor | engine | both
    hypotheses: Dict[str, float] = field(default_factory=dict)  # label -> penalized cost
    trace_residual: Dict[str, List[float]] = field(default_factory=dict)  # downsampled, for the UI
    seg: Optional[SortieSegments] = None  # the segments the decision was made on (reused by M4/M6)

    @property
    def distrusted(self) -> List[str]:
        return [f.channel for f in self.sensor_faults]


def _floor(ch):
    return SPIKE_FLOOR["egt"] if ch.startswith("egt") else SPIKE_FLOOR.get(ch, 0.0)


def shape_rules(df, expected: Dict[str, np.ndarray], noise_sigma: Optional[Dict[str, float]] = None):
    """Returns (faults, masks, excluded_channels).

    noise_sigma: per-channel reading scatter. When a channel's noise is at least ~0.4 ADC steps, a
    healthy sensor cannot repeat one code for a minute, so a long identical run is a freeze even when
    the physics says the true value is steady (live mode). Without it, a freeze is only called when the
    model says the value had to move (fleet mode).
    """
    running = (df["phase"].to_numpy() != "STARTUP") & (df["phase"].to_numpy() != "SHUTDOWN")
    faults, masks, excluded = [], {}, []
    for ch in FIT_CHANNELS:
        v = df[ch].to_numpy()
        # dropout: exact zeros while the engine runs
        zeros = running & (v == 0.0)
        if zeros.sum() > max(5, 0.01 * running.sum()):
            k = int(np.argmax(zeros))
            faults.append(SensorFault(ch, "dropout", 0.99, k, f"{int(zeros.sum())} zero readings in flight"))
            masks[ch] = zeros
            continue
        # stuck: longest run of identical readings, during which the physics says it had to move
        same = np.concatenate([[False], np.diff(v) == 0.0]) & running
        best_len, best_end, run = 0, 0, 0
        for i, s in enumerate(same):
            run = run + 1 if s else 0
            if run > best_len:
                best_len, best_end = run, i
        if best_len >= 60:
            a = best_end - best_len
            exp_seg = expected[ch][a:best_end + 1]
            lsb = ADC_LSB.get(ch, 0.01)
            noisy = noise_sigma is not None and noise_sigma.get(ch, 0.0) >= 0.4 * lsb
            if noisy or exp_seg.max() - exp_seg.min() > 6 * lsb:
                faults.append(SensorFault(ch, "stuck", 0.99, int(a),
                                          f"frozen at {v[a]:.2f} for {best_len} s while the model moved "
                                          f"{exp_seg.max() - exp_seg.min():.2f}"))
                excluded.append(ch)
                continue
        # spike: isolated excursions from a 5-point rolling median
        pad = np.pad(v, 2, mode="edge")
        med = np.median(np.lib.stride_tricks.sliding_window_view(pad, 5), axis=1)
        dev = np.abs(v - med)
        mad = np.median(np.abs(np.diff(v) - np.median(np.diff(v)))) * 1.4826 + 1e-9
        thr = max(12.0 * mad, _floor(ch))
        hits = running & (dev > thr)
        if hits.sum() >= 3:
            faults.append(SensorFault(ch, "spike", 0.95, int(np.argmax(hits)),
                                      f"{int(hits.sum())} isolated jumps > {thr:.2f}"))
            masks[ch] = hits
    return faults, masks, excluded


def _classify_residual(r: np.ndarray, t: np.ndarray):
    """Step (bias) vs ramp (drift) model on a per-second residual trace. Returns (mode, onset index)."""
    n = len(r)
    if n < 60:
        return "bias", 0
    best = ("bias", 0, np.inf)
    for k in range(0, n - 30, max(1, n // 60)):
        pre = r[:k]
        post = r[k:]
        base = pre.mean() if k > 0 else 0.0
        # step model
        sse_step = ((pre - base) ** 2).sum() + ((post - post.mean()) ** 2).sum()
        # ramp model from k
        x = t[k:] - t[k]
        slope = ((post - base) @ x) / max(1e-9, x @ x)
        sse_ramp = ((pre - base) ** 2).sum() + ((post - base - slope * x) ** 2).sum()
        for mode, sse in (("bias", sse_step), ("drift", sse_ramp)):
            if sse < best[2]:
                best = (mode, k, sse)
    return best[0], best[1]


def assess(df, bias: np.ndarray, sigma: np.ndarray, prior: np.ndarray) -> TrustResult:
    expected = model_trace(df, prior, bias)
    faults, masks, excluded = shape_rules(df, expected)
    seg = prepare(df, masks)

    f_eng = fit(seg, bias, sigma, prior, exclude=excluded)
    hyps = {"engine": f_eng.cost}
    best_fit, best_cost, best_ch, best_z = f_eng, f_eng.cost, None, 0.0

    absz = np.abs(f_eng.z)
    cnt = np.sum(~np.isnan(absz), axis=0)
    zbar = np.where(cnt > 0, np.nansum(absz, axis=0) / np.maximum(cnt, 1), 0.0)
    order = [i for i in np.argsort(-np.nan_to_num(zbar)) if zbar[i] > CANDIDATE_Z][:3]
    for i in order:
        ch = FIT_CHANNELS[i]
        if ch in excluded:
            continue
        f_s = fit(seg, bias, sigma, prior, exclude=excluded + [ch])
        pred = predict(seg, f_s.theta)
        z_ch = (seg.obs[:, i] - bias[i] - pred[:, i]) / sigma[i]
        z_ch = z_ch[seg.valid[:, i]]
        c = f_s.cost + LAMBDA
        hyps[f"sensor:{ch}"] = c
        if c < best_cost and len(z_ch) and np.mean(np.abs(z_ch)) > MIN_SENSOR_Z:
            best_fit, best_cost, best_ch, best_z = f_s, c, ch, float(np.mean(np.abs(z_ch)))

    trace_res = {}
    if best_ch is not None:
        trace = model_trace(df, best_fit.theta, bias)
        r = df[best_ch].to_numpy() - trace[best_ch]
        run = np.where(df["rpm"].to_numpy() > 2000)[0]
        mode, k = _classify_residual(r[run], df["t_s"].to_numpy()[run])
        margin = f_eng.cost - best_cost
        conf = float(1.0 / (1.0 + np.exp(-margin / 15.0)))
        faults.append(SensorFault(best_ch, mode, round(conf, 3), int(run[k]) if len(run) else None,
                                  f"disagrees with the physics prediction from the other channels by "
                                  f"{best_z:.1f} sigma; engine hypothesis costs {f_eng.cost - best_fit.cost:.0f} more"))
        trace_res[best_ch] = r[::10].round(3).tolist()

    engine_anom = bool(health_deficit(best_fit.theta).max() > ENGINE_DEFICIT_FLAG)
    sensor = bool(faults)
    attribution = "both" if (sensor and engine_anom) else "sensor" if sensor else "engine" if engine_anom else "none"
    return TrustResult(faults, best_fit, engine_anom, attribution, hyps, trace_res, seg)
