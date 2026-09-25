"""
S2 auto-debrief and S3 calibration audit.
"""

import numpy as np
import pandas as pd

from .physics import HF_LABEL, HF_NAMES

BINS = [0.0, 0.90, 0.95, 0.98, 0.99, 0.995, 1.0001]


def calibration_table(pcomp: pd.DataFrame):
    """Predicted P_complete vs realized completion, binned (out-of-fold predictions)."""
    df = pcomp.copy()
    df["bin"] = pd.cut(df.p, BINS, right=False)
    rows = []
    for b, g in df.groupby("bin", observed=True):
        rows.append({"bin": f"{b.left:.3f}-{min(1.0, b.right):.3f}", "n": int(len(g)),
                     "predicted": float(g.p.mean()), "realized": float(g.completed.mean()),
                     "failures": int((1 - g.completed).sum())})
    brier = float(((df.p - df.completed) ** 2).mean())
    base = float(((df.completed.mean() - df.completed) ** 2).mean())
    return {"bins": rows, "brier": brier, "brier_climatology": base,
            "skill": (1 - brier / base) if base > 0 else None}


def _has(v):
    return v is not None and not (isinstance(v, float) and np.isnan(v))


def _fmt_factor(i, theta, prev):
    n = HF_NAMES[i]
    delta = "" if prev is None else f" ({theta[i] - prev[i]:+.3f} since last sortie)"
    return f"{HF_LABEL[n]}: {theta[i]:.3f}{delta}"


def debrief_markdown(sorties: pd.DataFrame, recs: pd.DataFrame, engine_id: str, sortie: int, ledger=None) -> str:
    rec = recs[(recs.engine_id == engine_id) & (recs.sortie == sortie)].iloc[0]
    truth = sorties[(sorties.engine_id == engine_id) & (sorties.sortie == sortie)].iloc[0]
    prev = recs[(recs.engine_id == engine_id) & (recs.sortie == sortie - 1)]
    prev_theta = prev.iloc[0].theta if len(prev) else None
    th = rec.theta

    L = [f"# Debrief — {engine_id}, sortie {sortie + 1}",
         "",
         f"Engine age {rec.age_h:.0f} h since overhaul · mission {rec.duration_h:.1f} h at "
         f"{100 * rec.power:.0f}% loiter power · outcome: **{'ENGINE FAILURE' if truth.failed else 'completed'}**",
         ""]

    L.append("## Signal trust (M1)")
    if rec.commissioning:
        L.append("- Commissioning sortie: per-engine baseline (L1) still being learned; only shape rules applied.")
    if rec.sensor_faults:
        for f in rec.sensor_faults:
            L.append(f"- **{f['channel']}: {f['mode']}** (confidence {f['confidence']:.0%}) — {f['evidence']}. "
                     f"Excluded from health estimation; **no engine alarm raised from this channel**.")
    else:
        L.append("- All channels consistent with the physics twin.")
    L.append("")

    L.append("## Engine health (M2)")
    changed = sorted(range(len(HF_NAMES)), key=lambda i: -abs(th[i] - 1.0))[:3]
    for i in changed:
        L.append(f"- {_fmt_factor(i, th, prev_theta)}")
    L.append(f"- Worst factor **{rec.worst_factor}** at {100 * rec.deficit:.0f}% of the way to its failure threshold"
             + (f", moving {100 * rec.deficit_trend_100h:+.0f}% per 100 h" if rec.deficit_trend_100h >= 0.01 else "") + ".")
    if _has(rec.hours_to_thermal_limit):
        L.append(f"- M5: a hot-day take-off would reach the **{rec.thermal_channel}** redline in about "
                 f"**{rec.hours_to_thermal_limit:.0f} engine hours** on the current trend.")
    if _has(rec.hours_to_failure_threshold):
        L.append(f"- {rec.failure_factor} reaches its failure threshold in about {rec.hours_to_failure_threshold:.0f} h on the current trend.")
    L.append("")

    L.append("## Cylinders (M4)")
    L.append("- EGT split vs the other cylinders: " + ", ".join(
        f"cyl {k + 1} {'n/a' if v is None else f'{v:+.0f} degC'}" for k, v in enumerate(rec.cyl_dev)))
    L.append("")

    L.append("## Diagnosis (M6)")
    if rec.diagnosis["causes"]:
        for c in rec.diagnosis["causes"]:
            L.append(f"- **{c['label']}** ({c['score']:.0%}) — first check: {c['check']}")
            for e in c["evidence"]:
                L.append(f"  - {e}")
    else:
        L.append("- No fault indicated.")
    L.append("")

    if ledger is not None:
        rows = ledger.query("SELECT value FROM predictions WHERE engine_id=? AND sortie=? AND model='M8'",
                            (engine_id, int(sortie)))
        if rows:
            L.append("## Pre-flight prediction vs outcome (S1 ledger)")
            L.append(f"- Predicted P_complete {rows[0]['value']:.3f}; realized: "
                     f"{'failure' if truth.failed else 'completed'}.")
            L.append("")
    return "\n".join(L)
