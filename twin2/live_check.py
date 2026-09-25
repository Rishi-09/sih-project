"""
Headless end-to-end check of live mode against the real live simulator.

Flies retribution/server_ops OpsEngineSim with the same autopilot schedule the
server uses (server/src/twin/opsClient.ts), feeds every frame to LiveTwin exactly
as ops_loop.py does, injects each catalog fault mid-flight, and scores what the
twin concludes. No WebSocket, no Node - just the simulator and the model.

  python -m twin2.live_check              # healthy flight + every fault, pass/fail table
  python -m twin2.live_check --calibrate  # healthy flights -> residual scatter per channel
  python -m twin2.live_check --only turbo_degradation --severity 0.5
"""

import argparse
import sys
import time
from typing import Dict, List, Optional

import numpy as np

from . import RETRIBUTION
from .catalog import ENGINE_FAULTS, SENSOR_FAULTS
from .live import LiveTwin
from .physics import FIT_CHANNELS

if str(RETRIBUTION) not in sys.path:
    sys.path.insert(0, str(RETRIBUTION))
from server_ops.ops_engine import OpsEngineSim  # noqa: E402

DT = 0.25                 # simulated seconds per step (the server runs 0.05 at 1x; 0.25 == 5x speed)
ASSESS_EVERY_S = 5.0
INJECT_AT_S = 330.0       # after level-off at cruise
FLIGHT_END_S = 720.0
CRUISE_ALT_M = 3000.0

# opsClient.ts AUTOPILOT_SCHEDULE, minus the descent (the check ends in cruise)
SCHEDULE = [
    (0.0, None, {"throttle": 20, "gear": True, "autopilot": False}),
    (4.0, None, {"throttle": 95}),
    (15.0, None, {"throttle": 88, "autopilot": True, "ap_target_alt": CRUISE_ALT_M, "gear": False}),
    (110.0, lambda alt: alt >= CRUISE_ALT_M * 0.97, {"throttle": 68}),
    (520.0, None, {"throttle": 60}),  # a power change mid-cruise: the dynamic fit must ride through it
]


def fly(fault: Optional[str] = None, severity: float = 0.6, seed: int = 7, end_s: float = FLIGHT_END_S,
        on_assess=None, inject_at: float = INJECT_AT_S, events=None) -> List[dict]:
    """events: [(t, fault_id | "clear", severity)] - overrides fault/inject_at when given."""
    sim = OpsEngineSim(seed=seed)
    twin = LiveTwin()
    step_i, results, last_assess = 0, [], 0.0
    pending = list(events) if events is not None else ([(inject_at, fault, severity)] if fault else [])
    while True:
        frame = sim.step(dt=DT)
        t, alt = frame["t_s"], frame["alt_m"]
        while step_i < len(SCHEDULE):
            at, when, inp = SCHEDULE[step_i]
            if t < at:
                break
            if when is not None and not when(alt):
                nxt = SCHEDULE[step_i + 1][0] if step_i + 1 < len(SCHEDULE) else None
                if nxt is None or t < nxt:
                    break
            sim.set_player_input(inp)
            step_i += 1
        while pending and t >= pending[0][0]:
            _, what, sev = pending.pop(0)
            if what == "clear":
                sim.clear_faults()
            else:
                sim.inject_fault(what, sev)
        twin.observe(frame)
        if t - last_assess >= ASSESS_EVERY_S:
            last_assess = t
            r = twin.assess(twin.snapshot())
            if r is not None:
                r["_t"] = t
                r["_truth"] = frame["fault_label"]
                results.append(r)
                if on_assess:
                    on_assess(r, frame)
        if t >= end_s:
            return results


def _verdict(r: dict) -> str:
    tw = r["twin"]
    if tw["sensor_faults"]:
        return "sensor:" + ",".join(f"{f['channel']}/{f['mode']}" for f in tw["sensor_faults"])
    return r["fault_type"]


# The server e2e scenario (tools/e2e_live.mjs), replayed headlessly: faults injected during
# the climb and back to back, each judged within the time the console gives it.
SEQUENCE = [
    (90.0, "turbo_degradation", 0.6, "turbo_degradation", 200.0),
    (290.0, "clear", 0.0, "healthy", 150.0),
    (440.0, "sensor_bias_oilpress", 1.0, "sensor:oil_press_bar", 200.0),
    (640.0, "clear", 0.0, "healthy", 150.0),
    (790.0, "weak_cylinder_cyl2", 0.7, "weak_cylinder_cyl2", 200.0),
]


def _expectation(expect: str):
    """Predicate on an assessment for 'healthy', 'sensor:<channel>' or an engine fault id."""
    if expect == "healthy":
        return lambda r: r["fault_type"] == "healthy" and not r["twin"]["sensor_faults"]
    if expect.startswith("sensor:"):
        ch = expect.split(":")[1]
        return lambda r: any(x["channel"] == ch for x in r["twin"]["sensor_faults"]) and r["health_score"] >= 90
    return lambda r: r["fault_type"] == expect


def check_sequence() -> bool:
    events = [(t, f, s) for t, f, s, _, _ in SEQUENCE]
    res = fly(events=events, end_s=SEQUENCE[-1][0] + SEQUENCE[-1][4] + 5)
    ok_all = True
    for t, f, _, expect, within in SEQUENCE:
        window = [r for r in res if t <= r["_t"] <= t + within]
        ok = _expectation(expect)
        hit = next((r for r in window if ok(r)), None)
        # once reached, the verdict must hold to the end of this step
        held = hit is not None and all(ok(r) for r in window if r["_t"] >= hit["_t"] + 20)
        ok_all &= held
        seen = sorted({_verdict(r) for r in window})
        print(f"{'PASS' if held else 'FAIL'}  t={t:4.0f} {f:22} -> expect {expect:24} "
              f"{'reached +' + str(round(hit['_t'] - t)) + 's' if hit else 'never reached':16} seen={seen}")
    return ok_all


def check_fault(fault: str, severity: float, inject_at: float = INJECT_AT_S) -> dict:
    res = fly(fault, severity, inject_at=inject_at)
    after = [r for r in res if r["_t"] >= inject_at]
    if fault in SENSOR_FAULTS:
        ch = SENSOR_FAULTS[fault]["channel"]

        def ok(r):
            return any(f["channel"] == ch for f in r["twin"]["sensor_faults"])
    else:
        def ok(r):
            return any(c["id"] == fault for c in r["twin"]["causes"][:3])
    hit_t = next((r["_t"] for r in after if ok(r)), None)
    tail = after[-6:]  # the last 30 s: is the conclusion stable?
    final = tail[-1] if tail else None
    return {
        "fault": fault,
        "detected_after_s": None if hit_t is None else round(hit_t - inject_at),
        "stable": bool(tail) and all(ok(r) for r in tail),
        "final": _verdict(final) if final else "-",
        "top3": [c["id"] for c in final["twin"]["causes"][:3]] if final else [],
        "health": final["health_score"] if final else None,
        "ms": int(np.mean([r["twin"]["compute_ms"] for r in res])) if res else 0,
    }


def check_healthy(seeds=(7, 11)) -> dict:
    flags, n, qs = 0, 0, []
    for s in seeds:
        for r in fly(None, seed=s):
            n += 1
            qs.append(r["twin"]["unexplained"])
            if r["fault_type"] != "healthy" or r["twin"]["sensor_faults"]:
                flags += 1
    return {"assessments": n, "false_flags": flags, "median_unexplained": round(float(np.median(qs)), 2)}


def calibrate(seeds=(3, 7, 11, 19)):
    """Block-mean residual scatter of a HEALTHY engine against the healthy model, per channel."""
    from . import live as L
    z_all: Dict[str, List[float]] = {ch: [] for ch in FIT_CHANNELS}
    for s in seeds:
        for r in fly(None, seed=s):
            for ch, z in r["residual_z"].items():
                z_all[ch].append(z)
    print(f"{'channel':16} {'z rms':>7}  (target ~1.0; >1.3 raise BLOCK_FLOOR, <0.6 lower it)")
    for ch in FIT_CHANNELS:
        zz = np.array(z_all[ch])
        print(f"{ch:16} {np.sqrt(np.mean(zz ** 2)):7.2f}   floor now {L.BLOCK_FLOOR[ch]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--severity", type=float, default=0.6)
    ap.add_argument("--inject-at", type=float, default=INJECT_AT_S,
                    help="simulated second to inject at (default: cruise; ~90 is mid-climb)")
    ap.add_argument("--sequence", action="store_true", help="replay the server e2e scenario")
    a = ap.parse_args()
    if a.calibrate:
        calibrate()
        return
    if a.sequence:
        sys.exit(0 if check_sequence() else 1)
    t0 = time.time()
    faults = [a.only] if a.only else [*ENGINE_FAULTS, *SENSOR_FAULTS]
    if not a.only:
        h = check_healthy()
        print(f"healthy flights: {h['false_flags']} false flags in {h['assessments']} assessments "
              f"(median unexplained residual {h['median_unexplained']})")
    rows = []
    for f in faults:
        r = check_fault(f, a.severity, a.inject_at)
        rows.append(r)
        mark = "PASS" if r["stable"] else "FAIL"
        print(f"{mark}  {f:24} detected +{r['detected_after_s']}s  final={r['final']:34} "
              f"health={r['health']}  top3={r['top3']}  {r['ms']}ms/assess")
    passed = sum(r["stable"] for r in rows)
    print(f"\n{passed}/{len(rows)} faults correctly and stably identified  ({time.time() - t0:.0f}s)")
    sys.exit(0 if passed == len(rows) else 1)


if __name__ == "__main__":
    main()
