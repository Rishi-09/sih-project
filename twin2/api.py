"""
twin2 HTTP API for the console:  python -m twin2.api  (port 8100, TWIN2_PORT to change)

Serves the pipeline outputs in twin2/out (run `python -m twin2.run` first; the
API runs it automatically if the outputs are missing) and computes on demand:
per-sortie telemetry with the physics virtual-sensor trace, debriefs, and M8
mission advice for any planned profile.

  GET  /api/twin2/fleet
  GET  /api/twin2/engine/{engine_id}
  GET  /api/twin2/sortie/{engine_id}/{sortie}
  POST /api/twin2/mission          {engine_id, hours, power, target, oat_sl_c}
  GET  /api/twin2/reflection
"""

import json
import os
import sys

import numpy as np
import pandas as pd
from aiohttp import web

from . import OUT_DIR
from .fleet import build_fleet, sortie_telemetry
from .ledger import Ledger
from .models.m2_health import model_trace
from .models.m4_m5_m6 import steady_margins
from .models.m7_m8 import WeibullPH, advise
from .physics import FIT_CHANNELS, HF_FAIL, HF_LABEL, HF_NAMES, REDLINE
from .reflect import debrief_markdown
from .run import SEED, _clean

TELEMETRY_CHANNELS = ["throttle_pct", "alt_m", "rpm", "map_kpa", "fuel_flow_lph", "egt_1", "egt_2", "egt_3",
                      "egt_4", "coolant_temp_c", "oil_temp_c", "oil_press_bar", "vib_rms_g"]
DOWNSAMPLE = 5


class State:
    def __init__(self):
        if not (OUT_DIR / "fleet.json").exists():
            from .run import main as run_pipeline
            run_pipeline()
        self.fleet = json.loads((OUT_DIR / "fleet.json").read_text())
        self.validation = json.loads((OUT_DIR / "validation.json").read_text())
        self.calibration = json.loads((OUT_DIR / "calibration.json").read_text())
        self.recs = pd.read_json(OUT_DIR / "sorties.json", orient="records")
        self.truth = pd.read_json(OUT_DIR / "truth.json", orient="records")
        m = json.loads((OUT_DIR / "model.json").read_text())
        self.model = WeibullPH(m["log_k"], m["log_lam"], np.array(m["beta"]), np.array(m["cov"]),
                               m["n_events"], m["n_intervals"])
        self.engines, _ = build_fleet(SEED)
        self.engine_by_id = {e.engine_id: e for e in self.engines}
        self.ledger = Ledger(OUT_DIR / "ledger.db")
        self.level = {e["engine_id"]: np.array(e["level"]) for e in self.fleet["engines"]}

    def thermal_check(self, engine_id, power, oat_sl_c):
        th = self.level[engine_id]
        m_to = steady_margins(th, 100.0, 0.0, oat_sl_c, 65.0, "TAKEOFF")
        m_lo = steady_margins(th, power * 100, 3500.0, oat_sl_c - 22.75, 75.0, "LOITER")
        w_to = max(m_to, key=lambda c: m_to[c] / abs(REDLINE[c]))
        w_lo = max(m_lo, key=lambda c: m_lo[c] / abs(REDLINE[c]))
        ok = m_to[w_to] < 0 and m_lo[w_lo] < 0
        return ok, (f"take-off: {w_to} {m_to[w_to]:+.1f} vs redline; "
                    f"loiter: {w_lo} {m_lo[w_lo]:+.1f} vs redline")


def _json(data, status=200):
    return web.json_response(_clean(data), status=status, dumps=lambda o: json.dumps(o, default=str))


def _records(df):
    return json.loads(df.to_json(orient="records", default_handler=str))


def make_app() -> web.Application:
    st = State()

    @web.middleware
    async def cors(request, handler):
        if request.method == "OPTIONS":
            resp = web.Response()
        else:
            try:
                resp = await handler(request)
            except web.HTTPException as e:
                resp = web.json_response({"error": e.reason}, status=e.status)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "*"
        return resp

    app = web.Application(middlewares=[cors])

    async def fleet(_):
        f = dict(st.fleet)
        f["labels"] = HF_LABEL
        return _json(f)

    async def engine(request):
        eid = request.match_info["engine_id"]
        if eid not in st.engine_by_id:
            raise web.HTTPNotFound(reason=f"unknown engine {eid}")
        recs = st.recs[st.recs.engine_id == eid].sort_values("sortie")
        truth = st.truth[st.truth.engine_id == eid].sort_values("sortie")
        now = next(e for e in st.fleet["engines"] if e["engine_id"] == eid)
        x = np.array([now["deficit"], now["deficit_trend_100h"], 0.02])
        curve = st.model.survival_curve(now["age_h"], x, horizon_h=800, step_h=20)
        slim = recs[["sortie", "age_h", "duration_h", "power", "commissioning", "theta", "theta_sd", "deficit",
                     "worst_factor", "deficit_trend_100h", "attribution", "sensor_faults", "cyl_dev",
                     "hours_to_thermal_limit", "thermal_channel", "hours_to_failure_threshold", "failure_factor",
                     "diagnosis"]]
        tr = truth[["sortie", "failed", "failure_kind", "sf_channel", "sf_mode", "active_faults"] +
                   [f"true_{n}" for n in HF_NAMES]]
        return _json({"engine": now, "sorties": _records(slim), "truth": _records(tr), "survival": curve,
                      "health_factors": HF_NAMES, "labels": HF_LABEL, "fail_thresholds": HF_FAIL.tolist()})

    async def sortie(request):
        eid = request.match_info["engine_id"]
        n = int(request.match_info["sortie"])
        rows = st.truth[(st.truth.engine_id == eid) & (st.truth.sortie == n)]
        if eid not in st.engine_by_id or rows.empty:
            raise web.HTTPNotFound(reason=f"unknown sortie {eid}/{n}")
        row = rows.iloc[0].copy()
        row["holds"] = list(row["holds"])
        rec = st.recs[(st.recs.engine_id == eid) & (st.recs.sortie == n)].iloc[0]
        df = sortie_telemetry(row, st.engine_by_id[eid])
        trace = model_trace(df, np.array(rec.theta), np.array(rec.l1_bias))  # L1-learned offsets, not ground truth
        idx = np.arange(0, len(df), DOWNSAMPLE)
        tel = {"t_s": df["t_s"].to_numpy()[idx].tolist(), "phase": df["phase"].to_numpy()[idx].tolist()}
        for ch in TELEMETRY_CHANNELS:
            tel[ch] = np.round(df[ch].to_numpy()[idx], 3).tolist()
        expected = {ch: np.round(trace[ch][idx], 3).tolist() for ch in TELEMETRY_CHANNELS if ch in trace}
        md = debrief_markdown(st.truth, st.recs, eid, n, st.ledger)
        return _json({"record": json.loads(rec.to_json(default_handler=str)),
                      "truth": json.loads(rows.iloc[0].to_json(default_handler=str)),
                      "telemetry": tel, "expected": expected, "segments": df.attrs["segments"],
                      "debrief_md": md})

    async def mission(request):
        body = await request.json()
        eid = body.get("engine_id", "UAV-03")
        now = next((e for e in st.fleet["engines"] if e["engine_id"] == eid), None)
        if now is None:
            raise web.HTTPNotFound(reason=f"unknown engine {eid}")
        m = {"hours": float(body.get("hours", 20)), "power": float(body.get("power", 0.62)),
             "target": float(body.get("target", 0.95)), "oat_sl_c": float(body.get("oat_sl_c", 30))}
        service = [e for e in st.fleet["engines"] if e["in_service"]]
        res = advise(st.model, now, m, st.thermal_check, fleet=service)
        res["in_service"] = now["in_service"]
        res["mission"] = m
        return _json(res)

    async def reflection(_):
        recent = st.ledger.query("""
            SELECT p.engine_id, p.sortie, p.model, p.kind, p.value, p.payload, o.realized, o.correct
            FROM predictions p LEFT JOIN outcomes o ON o.prediction_id = p.id
            WHERE p.model IN ('M1','M6') AND (o.correct = 0 OR (p.model='M1' AND p.value > 0))
            ORDER BY p.engine_id, p.sortie LIMIT 60""")
        return _json({"validation": st.validation, "calibration": st.calibration,
                      "ledger": st.ledger.stats(), "notable": recent, "model": st.model.to_dict()})

    app.router.add_get("/api/twin2/fleet", fleet)
    app.router.add_get("/api/twin2/engine/{engine_id}", engine)
    app.router.add_get("/api/twin2/sortie/{engine_id}/{sortie}", sortie)
    app.router.add_post("/api/twin2/mission", mission)
    app.router.add_route("OPTIONS", "/api/twin2/mission", mission)
    app.router.add_get("/api/twin2/reflection", reflection)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("TWIN2_PORT", "8100"))
    print(f"twin2 API on http://localhost:{port}/api/twin2/fleet", file=sys.stderr)
    web.run_app(make_app(), port=port, print=None)
