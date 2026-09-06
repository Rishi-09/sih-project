"""Healthy-baseline regression check for the ops pipeline.

A healthy sortie must read healthy, and an injected fault must be named. Both
directions matter: the system was previously failing the first (a healthy climb
scored cooling 0.0 and diagnosed a compound lubrication fault), and any fix that
buys quiet by desensitising the model fails the second.

    python verify_health_baseline.py              # active classifier
    USE_FIXED=1 python verify_health_baseline.py  # ML/models/fault_classifier_fixed

Run after changing the ops flight model, the residual calibration, or either
model artifact.
"""

import sys
import numpy as np
import pandas as pd

from server_ops.ops_engine import OpsEngineSim
from pure_engine_ml import EngineHealthPipeline, CONTEXT_COLS, SENSOR_COLS

DT = 0.05


def fly(seed=42, target_alt=3000.0, cruise=68.0, duration=900.0, fault=None, biome="normal"):
    sim = OpsEngineSim(seed=seed)
    sched = [
        (0.0, {"throttle": 18.0, "gear": True, "autopilot": False, "biome": biome}),
        (10.0, {"throttle": 95.0}),
        (28.0, {"throttle": 88.0, "autopilot": True, "ap_target_alt": target_alt, "gear": False}),
    ]
    rows, i, levelled, injected = [], 0, False, False
    while sim.t_s < duration:
        while i < len(sched) and sim.t_s >= sched[i][0]:
            sim.set_player_input(sched[i][1]); i += 1
        if not levelled and rows and rows[-1]["alt_m"] >= target_alt * 0.98:
            sim.set_player_input({"throttle": cruise}); levelled = True
        if fault and not injected and sim.t_s >= fault[2]:
            sim.inject_fault(fault[0], fault[1]); injected = True
        rows.append(sim.step(dt=DT))
    df = pd.DataFrame(rows)
    df["sec"] = df["t_s"].astype(int)
    return df.groupby("sec").last().reset_index()


def report(title, df, pipe):
    print(f"\n===== {title} =====")
    print(f"{'t':>5} {'phase':<9} {'health':>7} {'worst subsystem':>28}   diagnosis")
    hist = []
    worst = 100.0
    for end in range(60, len(df), 45):
        win = df.iloc[end - 60:end][CONTEXT_COLS + SENSOR_COLS].copy()
        out = pipe.predict(win, health_history=hist)
        hist.append(out["health_score"])
        worst = min(worst, out["health_score"])
        lo = min(out["subsystem_scores"].items(), key=lambda kv: kv[1])
        r = df.iloc[end - 1]
        print(f"{int(r['t_s']):>5} {r['phase']:<9} {out['health_score']:>7.1f} "
              f"{lo[0] + '=' + format(lo[1], '.1f'):>28}   {out['fault_type'][:34]}")
    return worst


# Flying the OPS sim, so normalise with the ops calibration — the same thing
# ops_loop.py does in production.
import os
_FIXED = "ML/models/fault_classifier_fixed"
_dir = _FIXED if os.path.isdir(_FIXED) and os.environ.get("USE_FIXED") else "ML/models/fault_classifier"
print(f"classifier: {_dir}")
pipe = EngineHealthPipeline(residual_domain="ops", fault_classifier_dir=_dir)
w1 = report("HEALTHY — no faults injected (must stay high)", fly(seed=99), pipe)
w2 = report("HEALTHY — desert biome (must stay high)", fly(seed=123, biome="desert"), pipe)
w3 = report("COOLING FAILURE injected at t=400 (must be caught)",
            fly(seed=99, fault=("cooling_failure", 0.7, 400.0)), pipe)
w4 = report("LUBRICATION DEGRADATION at t=400 (must be caught)",
            fly(seed=99, fault=("lubrication_degradation", 0.6, 400.0)), pipe)

print("\n---- summary ----")
print(f"worst health, healthy normal : {w1:.1f}   (want high)")
print(f"worst health, healthy desert : {w2:.1f}   (want high)")
print(f"worst health, cooling failure: {w3:.1f}   (want low)")
print(f"worst health, lubrication    : {w4:.1f}   (want low)")
