"""
M7-lite  survival: Weibull proportional hazards over engine hours since overhaul,
         in counting-process form. Each sortie is an at-risk interval
         (age_start, age_end], so the model handles:
           - right censoring (engines still flying, or removed at TBO),
           - late entry (engines were already some hours old when observation began),
           - time-varying covariates (health as known BEFORE each sortie).
         Covariates: D = worst M2 health deficit, dD = its trend per 100 h, and
         mission power stress.
M8-lite  mission advisor: P_complete for a planned sortie, reliability-budget verdict
         (R1), profile options that trade time on station for P_complete (R3), fleet
         ranking for assignment (R2).
"""

from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
from scipy.optimize import minimize

COVARIATES = ["deficit", "deficit_trend_100h", "power_stress"]
BETA_PRIOR_SD = 6.0  # ridge on beta: few failures, keep the fit sane
# Weak prior on the Weibull shape: aero piston wear-out is k ~ 1-3. With a handful of
# failures and a covariate that explains most of them, the shape is otherwise unidentified
# and collapses toward 0.
LOG_K_PRIOR, LOG_K_PRIOR_SD = np.log(1.8), 0.35


@dataclass
class WeibullPH:
    log_k: float
    log_lam: float
    beta: np.ndarray
    cov: np.ndarray       # covariance of [log_k, log_lam, beta...]
    n_events: int
    n_intervals: int

    @property
    def k(self):
        return float(np.exp(self.log_k))

    @property
    def lam(self):
        return float(np.exp(self.log_lam))

    def cum_hazard(self, t0, t1, x, params=None):
        lk, ll, b = (self.log_k, self.log_lam, self.beta) if params is None else (params[0], params[1], params[2:])
        k, lam = np.exp(lk), np.exp(ll)
        return ((np.asarray(t1) / lam) ** k - (np.asarray(t0) / lam) ** k) * np.exp(np.asarray(x) @ b)

    def p_survive(self, t0, t1, x, n_draws: int = 0, rng=None):
        p = float(np.exp(-self.cum_hazard(t0, t1, x)))
        if not n_draws:
            return p
        rng = rng or np.random.default_rng(0)
        mean = np.concatenate([[self.log_k, self.log_lam], self.beta])
        draws = rng.multivariate_normal(mean, self.cov, size=n_draws, check_valid="ignore")
        ps = np.array([np.exp(-self.cum_hazard(t0, t1, x, d)) for d in draws])
        return p, float(np.quantile(ps, 0.1)), float(np.quantile(ps, 0.9))

    def survival_curve(self, age_now, x, horizon_h=1000, step_h=25):
        hs = np.arange(0, horizon_h + step_h, step_h)
        return [{"h": float(h), "s": float(np.exp(-self.cum_hazard(age_now, age_now + h, x)))} for h in hs]

    def to_dict(self):
        return {"k": self.k, "lambda_h": self.lam, "beta": dict(zip(COVARIATES, self.beta.round(3).tolist())),
                "n_events": self.n_events, "n_intervals": self.n_intervals}


def fit_weibull(t0, t1, event, X) -> WeibullPH:
    t0 = np.maximum(np.asarray(t0, float), 1e-3)
    t1 = np.asarray(t1, float)
    e = np.asarray(event, float)
    X = np.asarray(X, float)
    p = X.shape[1]

    def nll(w):
        lk, ll, b = w[0], w[1], w[2:]
        k, lam = np.exp(lk), np.exp(ll)
        eta = X @ b
        H = ((t1 / lam) ** k - (t0 / lam) ** k) * np.exp(eta)
        logh = lk - ll + (k - 1) * (np.log(t1) - ll) + eta
        return (-(e * logh - H).sum() + 0.5 * (b @ b) / BETA_PRIOR_SD ** 2
                + 0.5 * ((lk - LOG_K_PRIOR) / LOG_K_PRIOR_SD) ** 2)

    w0 = np.concatenate([[np.log(1.5), np.log(3000.0)], np.zeros(p)])
    sol = minimize(nll, w0, method="BFGS")
    cov = np.asarray(sol.hess_inv) if sol.hess_inv is not None else np.eye(len(w0)) * 0.1
    cov = (cov + cov.T) / 2
    return WeibullPH(float(sol.x[0]), float(sol.x[1]), sol.x[2:], cov, int(e.sum()), len(e))


def covariate_row(deficit, deficit_trend_100h, power):
    return np.array([deficit, max(0.0, deficit_trend_100h), power - 0.60])


# ── M8 ──────────────────────────────────────────────────────────────────────

GO, COND, NOGO = "go", "conditional_go", "no_go"
TRANSIT_FRACTION = 0.25  # share of a sortie spent in transit at cruise power


def verdict(p, target):
    if p >= target:
        return GO
    if p >= target - 0.10:
        return COND
    return NOGO


def mission_p(model: WeibullPH, engine: dict, hours: float, power: float, thermal_ok: bool, draws=200):
    d_mid = engine["deficit"] + max(0.0, engine["deficit_trend_100h"]) * hours / 200.0
    x = covariate_row(d_mid, engine["deficit_trend_100h"], power)
    if draws:
        p, lo, hi = model.p_survive(engine["age_h"], engine["age_h"] + hours, x, n_draws=draws)
    else:
        p = lo = hi = model.p_survive(engine["age_h"], engine["age_h"] + hours, x)
    if not thermal_ok:
        p, lo, hi = p * 0.5, lo * 0.5, hi * 0.5
    return p, lo, hi, x


def drivers(model: WeibullPH, engine: dict, x, hours):
    """Log-hazard contributions (bigger = more of the risk comes from here)."""
    base = model.cum_hazard(engine["age_h"], engine["age_h"] + hours, np.zeros_like(x))
    out = [{"driver": "Engine age / wear-out (Weibull baseline)",
            "detail": f"{engine['age_h']:.0f} h since overhaul, {hours:.0f} h planned",
            "hazard": float(base)}]
    labels = {"deficit": "Health deficit (M2)", "deficit_trend_100h": "Health trend (M2)",
              "power_stress": "Mission power stress"}
    for i, name in enumerate(COVARIATES):
        mult = float(np.exp(x[i] * model.beta[i]))
        out.append({"driver": labels[name], "detail": f"x{mult:.2f} hazard", "hazard_multiplier": mult})
    if engine.get("worst_factor"):
        out[1]["detail"] += f" — worst factor {engine['worst_factor']}"
    return out


def advise(model: WeibullPH, engine: dict, mission: dict, thermal_check, fleet: Optional[List[dict]] = None):
    """
    engine: {engine_id, age_h, deficit, deficit_trend_100h, worst_factor}
    mission: {hours, power (0-1), target (required P_complete), oat_sl_c}
    thermal_check(engine_id, power, oat_sl_c) -> (ok, detail)
    """
    hours, power, target = mission["hours"], mission["power"], mission.get("target", 0.95)
    ok, tdetail = thermal_check(engine["engine_id"], power, mission.get("oat_sl_c", 25.0))
    p, lo, hi, x = mission_p(model, engine, hours, power, ok)
    res = {
        "engine_id": engine["engine_id"], "p_complete": p, "p_lo": lo, "p_hi": hi,
        "verdict": verdict(p, target), "target": target, "thermal_ok": ok, "thermal_detail": tdetail,
        "drivers": drivers(model, engine, x, hours), "options": [],
    }

    # R3 option A: power cap -10 points. Transit takes longer (speed ~ power^(1/3)), loiter time shrinks.
    pc = max(0.35, power - 0.10)
    okA, _ = thermal_check(engine["engine_id"], pc, mission.get("oat_sl_c", 25.0))
    pA, loA, hiA, _ = mission_p(model, engine, hours, pc, okA)
    transit = hours * TRANSIT_FRACTION
    lost = transit * ((power / pc) ** (1 / 3) - 1.0)
    res["options"].append({
        "id": "power_cap", "label": f"Cap loiter power at {pc * 100:.0f}%",
        "p_complete": pA, "p_lo": loA, "p_hi": hiA, "verdict": verdict(pA, target),
        "time_on_station_cost_h": round(lost, 2),
    })

    # R3 option B: shorten the sortie until the budget is met (bisection on hours)
    lo_h, hi_h = 0.5, hours
    if mission_p(model, engine, hours, power, ok, draws=0)[0] >= target:
        best_h = hours
    elif mission_p(model, engine, lo_h, power, ok, draws=0)[0] < target:
        best_h = None
    else:
        for _ in range(30):
            mid = (lo_h + hi_h) / 2
            if mission_p(model, engine, mid, power, ok, draws=0)[0] >= target:
                lo_h = mid
            else:
                hi_h = mid
        best_h = lo_h
    if best_h is not None and best_h >= hours:
        res["options"].append({"id": "shorter_sortie", "label": "Full sortie length already meets the budget",
                               "p_complete": p, "p_lo": lo, "p_hi": hi, "verdict": verdict(p, target),
                               "time_on_station_cost_h": 0.0})
    elif best_h is not None:
        pB, loB, hiB, _ = mission_p(model, engine, best_h, power, ok)
        res["options"].append({
            "id": "shorter_sortie", "label": f"Shorten the sortie to {best_h:.1f} h",
            "p_complete": pB, "p_lo": loB, "p_hi": hiB, "verdict": verdict(pB, target),
            "time_on_station_cost_h": round(hours - best_h, 2),
        })
    else:
        res["options"].append({"id": "shorter_sortie", "label": "No sortie length meets the budget",
                               "p_complete": None, "verdict": NOGO, "time_on_station_cost_h": hours})

    # R2: fleet ranking for the same mission
    if fleet:
        ranking = []
        for e in fleet:
            okE, _ = thermal_check(e["engine_id"], power, mission.get("oat_sl_c", 25.0))
            pE = mission_p(model, e, hours, power, okE, draws=0)[0]
            ranking.append({"engine_id": e["engine_id"], "p_complete": pE, "verdict": verdict(pE, target),
                            "age_h": e["age_h"], "deficit": e["deficit"]})
        ranking.sort(key=lambda r: -r["p_complete"])
        res["fleet_ranking"] = ranking
        better = [r for r in ranking if r["engine_id"] != engine["engine_id"] and r["p_complete"] > p]
        if better:
            res["options"].append({"id": "swap_engine", "label": f"Assign {better[0]['engine_id']} instead",
                                   "p_complete": better[0]["p_complete"], "verdict": better[0]["verdict"],
                                   "time_on_station_cost_h": 0.0})
    return res
