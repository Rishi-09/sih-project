"""
M2-lite: physics-hybrid health estimation, and L1 per-engine baseline.

Per sortie, the 8 health factors are fitted to the steady power holds by
weighted least squares:

    observed segment mean  ~  steady_state(context, theta) + engine_bias

The physics fixes the structure (which channels each factor moves, and in which
direction). The fit recovers the magnitudes. The "hybrid" part is the
data-driven term: L1 learns a per-engine bias on every channel from the
engine's first sorties, so build-to-build scatter is not read as degradation.

Each fit starts from a prior: the engine's previous estimate, sd 0.05. Health
drifts slowly between sorties, so the prior stabilises weakly identified
factors without masking real change: a 5-sigma move needs only a 0.25 step.
"""

import warnings
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy.optimize import least_squares

from ..physics import (FIT_CHANNELS, HF_HEALTHY, HF_NAMES, apply_dynamics, apply_health,
                       nominal_targets, steady_state)

PRIOR_SD = np.array([0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.08, 0.05])
LOWER = np.array([0.40, 0.40, 0.20, 0.20, 0.20, 0.20, 0.90, 0.30])
UPPER = np.array([1.10, 1.10, 1.10, 1.10, 1.10, 1.10, 3.50, 1.10])
SEG_TAIL_USE_S = 100  # use the last 100 s of each steady window (thermal lags fully settled)

# Default segment-mean residual sigma per channel; replaced by calibrate_sigma() in the pipeline.
DEFAULT_SIGMA = {
    "rpm": 6.0, "vib_rms_g": 0.006, "egt_1": 2.5, "egt_2": 2.5, "egt_3": 2.5, "egt_4": 2.5,
    "coolant_temp_c": 0.4, "oil_press_bar": 0.03, "oil_temp_c": 0.4, "map_kpa": 0.3, "fuel_flow_lph": 0.2,
}


@dataclass
class SortieSegments:
    """Steady-segment view of one sortie, precomputed once so fits are cheap."""
    ctx: List[Dict[str, np.ndarray]]
    nominal: List[Dict[str, np.ndarray]]
    obs: np.ndarray            # (n_seg, n_ch) observed segment means (masked samples dropped)
    valid: np.ndarray          # (n_seg, n_ch) bool, False where a channel has no usable samples
    throttle: np.ndarray       # (n_seg,)
    t_mid: np.ndarray          # (n_seg,) segment centre time, s


def prepare(df, masks: Optional[Dict[str, np.ndarray]] = None) -> SortieSegments:
    """masks[ch] = boolean array over the sortie, True where a sample is corrupt (M1 shape rules)."""
    segs = df.attrs["segments"]
    ctx_l, nom_l, obs, valid, thr, tm = [], [], [], [], [], []
    for a, b in segs:
        a = max(a, b - SEG_TAIL_USE_S)
        sl = slice(a, b)
        ctx = {k: df[k].to_numpy()[sl] for k in ("throttle_pct", "alt_m", "oat_c", "ias_kt", "phase")}
        ctx_l.append(ctx)
        nom_l.append(nominal_targets(ctx["throttle_pct"], ctx["alt_m"], ctx["oat_c"], ctx["ias_kt"], ctx["phase"]))
        row, ok = [], []
        for ch in FIT_CHANNELS:
            v = df[ch].to_numpy()[sl]
            m = masks[ch][sl] if masks and ch in masks else np.zeros(len(v), bool)
            good = v[~m]
            ok.append(len(good) >= 20)
            row.append(good.mean() if len(good) else np.nan)
        obs.append(row)
        valid.append(ok)
        thr.append(ctx["throttle_pct"].mean())
        tm.append((a + b) / 2)
    return SortieSegments(ctx_l, nom_l, np.array(obs), np.array(valid), np.array(thr), np.array(tm))


def predict(seg: SortieSegments, theta) -> np.ndarray:
    """Model segment means for FIT_CHANNELS: (n_seg, n_ch)."""
    out = np.empty((len(seg.ctx), len(FIT_CHANNELS)))
    for i, (ctx, nom) in enumerate(zip(seg.ctx, seg.nominal)):
        h = apply_health(nom, ctx["throttle_pct"], theta)
        out[i] = [h[ch].mean() for ch in FIT_CHANNELS]
    return out


@dataclass
class HealthFit:
    theta: np.ndarray
    theta_sd: np.ndarray
    cost: float                # sum of squared normalized obs residuals + prior terms
    z: np.ndarray              # (n_seg, n_ch) normalized residuals at theta (nan where excluded)
    excluded: List[str] = field(default_factory=list)


def fit(seg: SortieSegments, bias: np.ndarray, sigma: np.ndarray, prior: np.ndarray,
        exclude: Sequence[str] = ()) -> HealthFit:
    use = seg.valid.copy()
    for ch in exclude:
        use[:, FIT_CHANNELS.index(ch)] = False
    target = seg.obs - bias[None, :]

    def resid(theta):
        r = (target - predict(seg, theta)) / sigma[None, :]
        return np.concatenate([r[use], (theta - prior) / PRIOR_SD])

    x0 = np.clip(prior, LOWER + 1e-6, UPPER - 1e-6)
    sol = least_squares(resid, x0, bounds=(LOWER, UPPER), x_scale=PRIOR_SD, method="trf")
    J = sol.jac
    try:
        cov = np.linalg.inv(J.T @ J)
        sd = np.sqrt(np.clip(np.diag(cov), 0, None))
    except np.linalg.LinAlgError:
        sd = PRIOR_SD.copy()
    z = (target - predict(seg, sol.x)) / sigma[None, :]
    z[~use] = np.nan
    return HealthFit(sol.x, sd, float(2 * sol.cost), z, list(exclude))


def model_trace(df, theta, bias: np.ndarray) -> Dict[str, np.ndarray]:
    """Per-second expected reading (physics virtual sensor) for the whole sortie, with dynamics."""
    tgt = steady_state(df["throttle_pct"].to_numpy(), df["alt_m"].to_numpy(), df["oat_c"].to_numpy(),
                       df["ias_kt"].to_numpy(), df["phase"].to_numpy(), theta)
    for i, ch in enumerate(FIT_CHANNELS):
        tgt[ch] = tgt[ch] + bias[i]
    return apply_dynamics(tgt)


# ── L1 per-engine baseline ─────────────────────────────────────────────────

class EngineBaseline:
    """
    L1: learns an engine's build offsets from its first sorties (assumed
    near-healthy after overhaul). Per channel, it takes the median of
    (observed - healthy model), skipping sensors that M1 distrusted.
    Until the baseline is frozen, the fleet-average (zero) offsets apply.
    """
    N_LEARN = 4

    def __init__(self):
        self.samples: List[np.ndarray] = []
        self.bias = np.zeros(len(FIT_CHANNELS))
        self.frozen = False

    def update(self, seg: SortieSegments, distrusted: Sequence[str]):
        if self.frozen:
            return
        r = seg.obs - predict(seg, HF_HEALTHY)
        r[~seg.valid] = np.nan
        for ch in distrusted:
            r[:, FIT_CHANNELS.index(ch)] = np.nan
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            self.samples.append(np.nanmean(r, axis=0))
            self.bias = np.nan_to_num(np.nanmedian(np.array(self.samples), axis=0))
        if len(self.samples) >= self.N_LEARN:
            self.frozen = True


def calibrate_sigma(fleet_rows, engines_by_id, telemetry_fn, n: int = 40) -> np.ndarray:
    """
    Segment-mean residual scatter on HEALTHY sorties with the engine's true bias
    removed, i.e. the irreducible noise + lag floor the fit has to live with.
    """
    from ..physics import HF_NAMES as _H  # noqa: F401
    res = []
    for _, row in fleet_rows.head(n).iterrows():
        eng = engines_by_id[row["engine_id"]]
        df = telemetry_fn(row, eng)
        seg = prepare(df)
        theta = np.array([row[f"true_{h}"] for h in HF_NAMES])
        true_bias = np.array([eng.bias.get(ch, 0.0) for ch in FIT_CHANNELS])
        res.append(seg.obs - true_bias[None, :] - predict(seg, theta))
    r = np.concatenate(res)
    sd = np.sqrt(np.mean(r ** 2, axis=0))
    floor = np.array([DEFAULT_SIGMA[ch] * 0.5 for ch in FIT_CHANNELS])
    return np.maximum(sd, floor)
