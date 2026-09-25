"""
One command, full loop:  python -m twin2.run

  fleet -> M1 trust + M2 health (+ L1 baseline) -> M4 -> M5 -> M6
        -> M7 survival (5-fold by engine, out-of-fold pre-flight P_complete)
        -> M8 advisor + fleet ranking -> S1 ledger -> S2 debriefs -> S3 calibration
        -> validation against the prototype success criteria (plan B5)
        -> twin2/out/*.json for the API / console
"""

import json
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict

import numpy as np
import pandas as pd

from . import OUT_DIR
from .fleet import build_fleet, engines_table, sortie_telemetry
from .ledger import Ledger
from .models.m1_trust import TrustResult, assess, shape_rules
from .models.m2_health import EngineBaseline, calibrate_sigma, fit, model_trace, prepare
from .models.m4_m5_m6 import (HOT_TAKEOFF, cylinder_split, cylinder_trend, diagnose, factor_trend,
                              hours_to_failure_threshold, hours_to_thermal_limit, signature, steady_margins)
from .models.m7_m8 import WeibullPH, advise, covariate_row, fit_weibull
from .physics import FIT_CHANNELS, HF_FAIL, HF_HEALTHY, HF_NAMES, REDLINE, health_deficit, mismatch_spec
from .reflect import calibration_table, debrief_markdown

SEED = 7
MISMATCH_REL = 0.15  # robustness test: true physics coefficients differ from the twin's by up to +-15%
DEFAULT_MISSION = {"hours": 20.0, "power": 0.62, "target": 0.95, "oat_sl_c": 30.0}


# ── per-engine processing (M1, M2, L1, M4, M5, M6) ──────────────────────────

def _process_engine(args):
    engine_id, sigma, mismatch_rel = args
    mm = mismatch_spec(engine_id, mismatch_rel) if mismatch_rel else None
    engines, sorties = build_fleet(SEED)
    spec = next(e for e in engines if e.engine_id == engine_id)
    rows = sorties[sorties.engine_id == engine_id]

    baseline = EngineBaseline()
    prior = HF_HEALTHY.copy()
    thetas, ages, cyl_hist, recs = [], [], [], []
    pre_deficit, pre_trend = 0.0, 0.0
    for _, row in rows.iterrows():
        df = sortie_telemetry(row, spec, mm)
        commissioning = not baseline.frozen
        if commissioning:
            # L1 commissioning: shape rules only, learn build offsets, then fit health
            expected = model_trace(df, prior, baseline.bias)
            faults, masks, excluded = shape_rules(df, expected)
            seg = prepare(df, masks)
            baseline.update(seg, [f.channel for f in faults])
            hf = fit(seg, baseline.bias, sigma, prior, exclude=excluded)
            trust = TrustResult(faults, hf, False, "sensor" if faults else "none", seg=seg)
        else:
            trust = assess(df, baseline.bias, sigma, prior)
            seg = trust.seg
        theta = trust.health.theta
        prior = theta
        thetas.append(theta)
        ages.append(float(row.age_h))

        cyl = cylinder_split(seg.obs, seg.valid, baseline.bias, trust.distrusted)
        cyl_hist.append(cyl)
        cyl_sl = cylinder_trend(cyl_hist, ages)

        slope, level = factor_trend(np.array(thetas), np.array(ages))
        d_level = health_deficit(level)
        worst = int(np.argmax(d_level))
        d_rate = float(-(slope[worst] / (HF_HEALTHY[worst] - HF_FAIL[worst])) * 100.0)
        h_thermal, thermal_ch = hours_to_thermal_limit(level, slope)
        h_fail, fail_factor = hours_to_failure_threshold(level, slope)
        raw = signature(seg, baseline.bias, sigma, trust.distrusted)
        dx = diagnose(theta, trust.health.theta_sd, slope, cyl, cyl_sl, trust.sensor_faults, raw)

        recs.append({
            "engine_id": engine_id, "sortie": int(row.sortie), "age_h": float(row.age_h),
            "duration_h": float(row.duration_h), "power": float(row.power), "commissioning": commissioning,
            "theta": theta.round(4).tolist(), "theta_sd": trust.health.theta_sd.round(4).tolist(),
            "level": level.round(4).tolist(), "slope_per_100h": (slope * 100).round(5).tolist(),
            "deficit": float(d_level.max()), "worst_factor": HF_NAMES[worst], "deficit_trend_100h": d_rate,
            "pre_deficit": pre_deficit, "pre_trend_100h": pre_trend,
            "attribution": trust.attribution, "engine_anomaly": trust.engine_anomaly,
            "sensor_faults": [asdict(f) for f in trust.sensor_faults],
            "hypotheses": {k: round(v, 1) for k, v in trust.hypotheses.items()},
            "trace_residual": trust.trace_residual,
            "cyl_dev": [None if v is None else round(v, 1) for v in cyl], "cyl_slope_100h": [round(v, 2) for v in cyl_sl],
            "hours_to_thermal_limit": h_thermal, "thermal_channel": thermal_ch,
            "hours_to_failure_threshold": h_fail, "failure_factor": fail_factor,
            "raw_signature": {k: round(v, 1) for k, v in raw.items()},
            "diagnosis": dx,
            "l1_bias": baseline.bias.round(4).tolist(),
        })
        pre_deficit, pre_trend = float(d_level.max()), max(0.0, d_rate)
    return recs


# ── validation helpers ─────────────────────────────────────────────────────

def _true_worst(row):
    th = np.array([row[f"true_{n}"] for n in HF_NAMES])
    d = health_deficit(th)
    i = int(np.argmax(d))
    return HF_NAMES[i], float(d[i])


FACTOR_TO_KIND = {"ve": "induction_leak", "eta_turbo": "turbo_degradation", "oil_res": "oil_restriction",
                  "cool_eff": "coolant_restriction"}


def validate(sorties: pd.DataFrame, recs: pd.DataFrame, pcomp: pd.DataFrame):
    m = sorties.merge(recs, on=["engine_id", "sortie"], suffixes=("", "_est"))
    post = m[~m.commissioning]
    out = {}

    # 1. Sensor-vs-engine attribution
    tw = post.apply(_true_worst, axis=1, result_type="expand")
    post = post.assign(true_factor=tw[0], true_def=tw[1])
    rows = []
    for _, r in post.iterrows():
        flagged = {f["channel"] for f in r.sensor_faults}
        truth_sensor = bool(r.sf_channel)
        truth_engine = r.true_def > 0.15
        if not (truth_sensor or truth_engine):
            continue
        ok = True
        if truth_sensor:
            ok &= r.sf_channel in flagged
        else:
            ok &= not flagged
        if truth_engine:
            ok &= bool(r.engine_anomaly)
        rows.append({"sensor": truth_sensor, "engine": truth_engine, "ok": ok})
    att = pd.DataFrame(rows)
    normal = post[(post.sf_channel == "") & (post.true_def <= 0.15)]
    false_sensor = normal.sensor_faults.apply(len).gt(0).mean()
    false_engine = normal.engine_anomaly.mean()
    out["attribution"] = {
        "n_events": int(len(att)), "accuracy": float(att.ok.mean()),
        "sensor_cases": int(att.sensor.sum()), "sensor_accuracy": float(att[att.sensor].ok.mean()),
        "engine_cases": int((att.engine & ~att.sensor).sum()),
        "engine_accuracy": float(att[att.engine & ~att.sensor].ok.mean()),
        "false_sensor_rate_normal": float(false_sensor), "false_engine_rate_normal": float(false_engine),
        "n_normal": int(len(normal)),
        "commissioning_sensor_faults_missed": int(((m.commissioning) & (m.sf_channel != "") &
                                                   ~m.apply(lambda r: r.sf_channel in {f["channel"] for f in r.sensor_faults}, axis=1)).sum()),
        "target": 0.85,
    }

    # 2. Slow faults visible as health-factor drift before the limit
    engines, _ = build_fleet(SEED)
    per_kind = {}
    for e in engines:
        er = m[m.engine_id == e.engine_id].sort_values("sortie")
        for f in e.faults:
            i = HF_NAMES.index(f.factor)
            th_est = np.array(er.theta.tolist())[:, i]
            d_est = np.clip((th_est - 1) / (HF_FAIL[i] - 1), 0, None)
            d_true = np.clip((er[f"true_{f.factor}"].to_numpy() - 1) / (HF_FAIL[i] - 1), 0, None)
            if d_true.max() < 0.15:
                continue  # never developed within the observation window
            det = np.where((d_est > 0.15) & ~er.commissioning.to_numpy())[0]
            end_age = float(er.age_h.iloc[-1] + er.duration_h.iloc[-1])
            limit_idx = np.where(d_true >= 0.99)[0]
            limit_age = float(er.age_h.iloc[limit_idx[0]]) if len(limit_idx) else (end_age if er.failed.any() else None)
            if len(det):
                det_age = float(er.age_h.iloc[det[0]])
                lead = (limit_age - det_age) if limit_age is not None else None
                before = lead is None or lead > 0
            else:
                det_age, lead, before = None, None, False
            per_kind.setdefault(f.kind, []).append({
                "engine_id": e.engine_id, "factor": f.factor, "detected_at_h": det_age,
                "limit_at_h": limit_age, "lead_h": lead, "detected_before_limit": before})
    out["slow_faults"] = {
        "per_kind": per_kind,
        "kinds_detected_before_limit": int(sum(all(x["detected_before_limit"] for x in v) for v in per_kind.values())),
        "kinds_present": len(per_kind), "target": "4 of 5",
    }

    # 3. M6 top-3 contains the cause
    hits = []
    for _, r in post.iterrows():
        causes = [c["id"] for c in r.diagnosis["causes"]]
        if r.sf_channel:
            hits.append(("sensor_fault", "sensor_fault" in causes))
        if r.true_def > 0.2:
            kind = "weak_cylinder" if r.true_factor.startswith("comb") else FACTOR_TO_KIND[r.true_factor]
            hits.append((kind, kind in causes))
    h = pd.DataFrame(hits, columns=["cause", "hit"])
    out["diagnosis_top3"] = {"n": int(len(h)), "accuracy": float(h.hit.mean()),
                             "per_cause": h.groupby("cause").hit.mean().round(3).to_dict(), "target": 0.80}

    # 4. M7/M8 calibration (out-of-fold)
    out["p_complete"] = {"n": int(len(pcomp)), "brier": float(((pcomp.p - pcomp.completed) ** 2).mean()),
                         "mean_p": float(pcomp.p.mean()), "realized": float(pcomp.completed.mean()),
                         "failures": int((1 - pcomp.completed).sum())}
    return out


# ── main ───────────────────────────────────────────────────────────────────

def _assess_fleet(engines, sorties, mismatch_rel: float):
    """M1/M2/L1/M4/M5/M6 for every engine in parallel. Noise sigma is calibrated on healthy sorties first."""
    by_id = {e.engine_id: e for e in engines}
    healthy = sorties[(sorties.true_deficit_max < 0.06) & (sorties.sf_channel == "")]
    tel = (lambda row, eng: sortie_telemetry(row, eng, mismatch_spec(eng.engine_id, mismatch_rel)))         if mismatch_rel else sortie_telemetry
    sigma = calibrate_sigma(healthy.sample(60, random_state=0), by_id, tel, n=60)
    with ProcessPoolExecutor() as ex:
        results = list(ex.map(_process_engine, [(e.engine_id, sigma, mismatch_rel) for e in engines]))
    return pd.DataFrame([r for eng in results for r in eng]), sigma


def main(robustness: bool = True):
    t0 = time.time()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    engines, sorties = build_fleet(SEED)
    by_id = {e.engine_id: e for e in engines}
    print(f"[fleet] {len(engines)} engines, {len(sorties)} sorties, "
          f"{int(sorties.failed.sum())} failures, {int((sorties.sf_channel != '').sum())} sensor faults")

    recs, sigma = _assess_fleet(engines, sorties, mismatch_rel=0.0)
    print(f"[M1/M2/M4/M5/M6] {len(recs)} sorties assessed in {time.time() - t0:.1f}s")

    # M7: 5-fold by engine for honest pre-flight predictions, then a final fit on everything
    m = sorties.merge(recs[["engine_id", "sortie", "pre_deficit", "pre_trend_100h"]], on=["engine_id", "sortie"])
    X = np.stack([covariate_row(a, b, p) for a, b, p in zip(m.pre_deficit, m.pre_trend_100h, m.power)])
    t_start, t_end = m.age_h.to_numpy(), (m.age_h + m.duration_h).to_numpy()
    ev = m.failed.astype(int).to_numpy()
    ids = np.array(sorted(m.engine_id.unique()))
    rng = np.random.default_rng(0)
    folds = np.array_split(rng.permutation(ids), 5)
    p_oof = np.zeros(len(m))
    for fold in folds:
        test = m.engine_id.isin(fold).to_numpy()
        mdl = fit_weibull(t_start[~test], t_end[~test], ev[~test], X[~test])
        p_oof[test] = np.exp(-mdl.cum_hazard(t_start[test], t_end[test], X[test]))
    model = fit_weibull(t_start, t_end, ev, X)
    pcomp = pd.DataFrame({"engine_id": m.engine_id, "sortie": m.sortie, "p": p_oof, "completed": 1 - ev})
    print(f"[M7] Weibull k={model.k:.2f} lambda={model.lam:.0f} h beta={model.beta.round(2)} events={model.n_events}")

    # ── S1 ledger ──
    ledger = Ledger(OUT_DIR / "ledger.db", fresh=True)
    for e in engines:
        ledger.add_engine(e.engine_id, e.serial, e.age0_h, e.scripted)
    recs_idx = recs.set_index(["engine_id", "sortie"])
    for (_, r), p in zip(m.iterrows(), p_oof):
        ledger.add_sortie(r)
        rec = recs_idx.loc[(r.engine_id, r.sortie)]
        # M8 pre-flight P_complete, resolved by whether the sortie completed
        pid = ledger.predict(r.engine_id, r.sortie, "M8", "p_complete", r.age_h, p,
                             {"hours": r.duration_h, "power": r.power})
        ledger.resolve(pid, realized=1 - int(r.failed), correct=None)
        # M1 attribution, resolved against ground truth (in service: the maintenance finding)
        flagged = [f["channel"] for f in rec.sensor_faults]
        pid = ledger.predict(r.engine_id, r.sortie, "M1", "sensor_faults", r.age_h, len(flagged), flagged)
        ledger.resolve(pid, realized=int(bool(r.sf_channel)),
                       correct=(r.sf_channel in flagged) if r.sf_channel else (not flagged),
                       payload={"true_channel": r.sf_channel, "true_mode": r.sf_mode})
        # M6 top-3 (only when it names a cause)
        causes = [c["id"] for c in rec.diagnosis["causes"]]
        if causes:
            tf, td = _true_worst(r)
            truth = []
            if r.sf_channel:
                truth.append("sensor_fault")
            if td > 0.2:
                truth.append("weak_cylinder" if tf.startswith("comb") else FACTOR_TO_KIND[tf])
            pid = ledger.predict(r.engine_id, r.sortie, "M6", "top3", r.age_h, rec.diagnosis["causes"][0]["score"], causes)
            if truth:
                ledger.resolve(pid, correct=any(t in causes for t in truth), payload={"truth": truth})
        # M5 hours to thermal limit
        if rec.hours_to_thermal_limit is not None:
            ledger.predict(r.engine_id, r.sortie, "M5", "hours_to_thermal_limit", r.age_h,
                           rec.hours_to_thermal_limit, {"channel": rec.thermal_channel})
    ledger.commit()

    # ── current fleet state + M8 ──
    last = recs.sort_values("sortie").groupby("engine_id").tail(1).set_index("engine_id")
    status = sorties.groupby("engine_id").agg(failed=("failed", "any"), last_age=("age_h", "max"),
                                              n=("sortie", "size"))
    fleet_now = []
    for e in engines:
        lr = last.loc[e.engine_id]
        st = status.loc[e.engine_id]
        sr = sorties[(sorties.engine_id == e.engine_id)].iloc[-1]
        in_service = (not st.failed) and (sr.age_h + sr.duration_h) < 2000
        fleet_now.append({
            "engine_id": e.engine_id, "serial": e.serial, "scripted": e.scripted,
            "age_h": float(sr.age_h + sr.duration_h), "sorties": int(st.n), "in_service": bool(in_service),
            "failed": bool(st.failed), "failure_kind": sr.failure_kind if st.failed else "",
            "deficit": float(lr.deficit), "deficit_trend_100h": max(0.0, float(lr.deficit_trend_100h)),
            "worst_factor": lr.worst_factor, "level": lr.level,
            "hours_to_thermal_limit": lr.hours_to_thermal_limit, "thermal_channel": lr.thermal_channel,
            "hours_to_failure_threshold": lr.hours_to_failure_threshold, "failure_factor": lr.failure_factor,
            "top_cause": (lr.diagnosis["causes"][0] if lr.diagnosis["causes"] else None),
        })
    level_by_id = {f["engine_id"]: np.array(f["level"]) for f in fleet_now}

    def thermal_check(engine_id, power, oat_sl_c):
        th = level_by_id[engine_id]
        m_to = steady_margins(th, 100.0, 0.0, oat_sl_c, 65.0, "TAKEOFF")
        m_lo = steady_margins(th, power * 100, 3500.0, oat_sl_c - 22.75, 75.0, "LOITER")
        # binding channel = least RELATIVE headroom (bar and degC are not comparable)
        worst_to = max(m_to, key=lambda c: m_to[c] / abs(REDLINE[c]))
        worst_lo = max(m_lo, key=lambda c: m_lo[c] / abs(REDLINE[c]))
        ok = m_to[worst_to] < 0 and m_lo[worst_lo] < 0
        return ok, (f"take-off: {worst_to} {m_to[worst_to]:+.1f} vs redline; "
                    f"loiter: {worst_lo} {m_lo[worst_lo]:+.1f} vs redline")

    service = [f for f in fleet_now if f["in_service"]]
    for f in fleet_now:
        if f["in_service"]:
            a = advise(model, f, DEFAULT_MISSION, thermal_check)
            f["p_complete"], f["verdict"] = a["p_complete"], a["verdict"]
        else:
            f["p_complete"], f["verdict"] = None, "out_of_service"
    demo = advise(model, next(f for f in fleet_now if f["engine_id"] == "UAV-03"), DEFAULT_MISSION,
                  thermal_check, fleet=service)

    # ── S2/S3 + validation ──
    val = validate(sorties, recs, pcomp)
    if robustness:
        # Same pipeline, but every engine's true physics differs from the twin's (see physics.mismatch_spec)
        rrecs, _ = _assess_fleet(engines, sorties, mismatch_rel=MISMATCH_REL)
        rv = validate(sorties, rrecs, pcomp)
        val["robustness"] = {
            "coef_error": MISMATCH_REL,
            "attribution": rv["attribution"]["accuracy"],
            "sensor_accuracy": rv["attribution"]["sensor_accuracy"],
            "engine_accuracy": rv["attribution"]["engine_accuracy"],
            "false_sensor_rate": rv["attribution"]["false_sensor_rate_normal"],
            "false_engine_rate": rv["attribution"]["false_engine_rate_normal"],
            "diagnosis_top3": rv["diagnosis_top3"]["accuracy"],
            "slow_kinds_before_limit": rv["slow_faults"]["kinds_detected_before_limit"],
            "slow_kinds_present": rv["slow_faults"]["kinds_present"],
        }
    cal = calibration_table(pcomp)
    val["ledger"] = ledger.stats()
    demo_debrief = debrief_markdown(sorties, recs, "UAV-11", 19, ledger)

    # ── export ──
    def dump(name, obj):
        (OUT_DIR / name).write_text(json.dumps(_clean(obj), indent=1, default=_json_default))

    dump("fleet.json", {"engines": fleet_now, "mission": DEFAULT_MISSION, "model": model.to_dict(),
                        "health_factors": HF_NAMES, "fail_thresholds": HF_FAIL.tolist()})
    dump("validation.json", val)
    dump("calibration.json", cal)
    dump("demo_mission.json", demo)
    recs.to_json(OUT_DIR / "sorties.json", orient="records", default_handler=str)
    sorties.to_json(OUT_DIR / "truth.json", orient="records", default_handler=str)
    engines_table(engines).to_json(OUT_DIR / "engines.json", orient="records")
    np.save(OUT_DIR / "sigma.npy", sigma)
    (OUT_DIR / "model.json").write_text(json.dumps({
        "log_k": model.log_k, "log_lam": model.log_lam, "beta": model.beta.tolist(), "cov": model.cov.tolist(),
        "n_events": model.n_events, "n_intervals": model.n_intervals}))
    (OUT_DIR / "debrief_UAV-11_s19.md").write_text(demo_debrief, encoding="utf-8")

    _print_report(val, demo, time.time() - t0)
    return val


def _clean(o):
    """NaN/inf -> None recursively (JSON has no NaN; browsers reject it)."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    return o


def _json_default(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return str(o)


def _print_report(val, demo, secs):
    a, s, d, p = val["attribution"], val["slow_faults"], val["diagnosis_top3"], val["p_complete"]
    print("\n== Prototype success criteria (plan B5) ==")
    print(f"  Full loop, one command ........................ yes ({secs:.0f}s)")
    print(f"  Sensor-vs-engine attribution (>= 85%) ......... {a['accuracy']:.1%}  "
          f"(sensor {a['sensor_accuracy']:.1%} of {a['sensor_cases']}, engine {a['engine_accuracy']:.1%} of {a['engine_cases']}; "
          f"false sensor flags on normal sorties {a['false_sensor_rate_normal']:.1%})")
    print(f"  Slow faults seen as drift before limit (4/5) .. {s['kinds_detected_before_limit']} of {s['kinds_present']} kinds")
    print(f"  M6 top-3 contains the cause (>= 80%) .......... {d['accuracy']:.1%} of {d['n']}  {d['per_cause']}")
    print(f"  P_complete + verdict + options ................ yes  (UAV-03: P={demo['p_complete']:.3f} "
          f"{demo['verdict']}, {len(demo['options'])} options)")
    print(f"  Ledger reliability + debrief .................. yes  (Brier {p['brier']:.4f}, "
          f"{p['failures']} failures in {p['n']} sorties)")
    r = val.get("robustness")
    if r:
        print(f"\n== Physics-mismatch stress test (true coefficients +-{100 * r['coef_error']:.0f}%, "
              f"unmodelled operating-point errors) ==")
        print(f"  attribution {r['attribution']:.1%} (sensor {r['sensor_accuracy']:.1%}, engine {r['engine_accuracy']:.1%}); "
              f"false sensor flags {r['false_sensor_rate']:.1%}, false engine flags {r['false_engine_rate']:.1%}")
        print(f"  M6 top-3 {r['diagnosis_top3']:.1%}; slow faults before limit {r['slow_kinds_before_limit']} of {r['slow_kinds_present']}")


if __name__ == "__main__":
    import sys
    main(robustness="--no-robustness" not in sys.argv)
