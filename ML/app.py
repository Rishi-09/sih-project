"""
R2 UAV Engine ML Inference — Hugging Face Spaces (Gradio SDK, Free Tier).

Uses the FREE Gradio SDK on Hugging Face Spaces (no paid Docker required).
Gradio is mounted on top of FastAPI so that:
1. /health, /schema, /predict REST endpoints work seamlessly for backend server requests.
2. The interactive Gradio web UI is available at root for manual testing.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

import gradio as gr
import numpy as np
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine_pipeline import (
    CONTEXT_COLS,
    SENSOR_COLS,
    PHASE_CATEGORIES,
    SUBSYSTEM_MAP,
    get_pipeline,
)

# ── 1. FastAPI Application ─────────────────────────────────────────────
app = FastAPI(
    title="R2 UAV Engine ML Service",
    description="Real-time ML inference for 19-channel aircraft piston engine telemetry",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 2. Pre-load Models ─────────────────────────────────────────────────
pipeline = get_pipeline()
print(
    f"[ML API] Pipeline loaded — {len(SENSOR_COLS)} sensor channels, "
    f"{len(SUBSYSTEM_MAP)} subsystems ready."
)

# ── 3. Request Schema ──────────────────────────────────────────────────
class PredictRequest(BaseModel):
    telemetry: Union[List[Dict[str, Any]], Dict[str, List[Any]]] = Field(
        ...,
        description="≥60 rows of engine telemetry (list of row dicts or dict of column arrays).",
    )
    health_history: Optional[List[float]] = Field(
        None,
        description="Optional historical health scores for RUL slope extrapolation.",
    )

# ── 4. REST Endpoints ──────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    """Keep-alive target — pinged every 24h by Railway server to prevent HF sleep."""
    p = get_pipeline()
    return {
        "status": "ok",
        "models_loaded": p.twin_bundle is not None and p.fault_classifier is not None,
        "service": "r2-uav-engine-ml",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/schema")
async def get_schema():
    """Required telemetry input columns."""
    return {
        "required_context_columns": CONTEXT_COLS,
        "required_sensor_columns": SENSOR_COLS,
        "total_required_columns": len(CONTEXT_COLS) + len(SENSOR_COLS),
        "minimum_window_rows": 60,
        "flight_phases": PHASE_CATEGORIES,
        "subsystems": SUBSYSTEM_MAP,
    }


@app.post("/predict")
async def rest_predict(req: PredictRequest):
    """Full diagnostic inference via REST."""
    try:
        if isinstance(req.telemetry, list):
            df = pd.DataFrame(req.telemetry)
        else:
            df = pd.DataFrame(req.telemetry)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse telemetry: {e}")

    if len(df) < 60:
        raise HTTPException(status_code=400, detail=f"Need ≥60 rows, got {len(df)}.")

    missing = [c for c in CONTEXT_COLS + SENSOR_COLS if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {missing}")

    try:
        result = pipeline.predict(df, health_history=req.health_history)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")


# ── 5. Gradio UI Interface ─────────────────────────────────────────────
def gradio_predict(telemetry_json: str) -> str:
    """Accept raw JSON telemetry in UI and return diagnostic payload."""
    try:
        raw = json.loads(telemetry_json)
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"Invalid JSON: {e}"}, indent=2)

    try:
        if isinstance(raw, list):
            df = pd.DataFrame(raw)
        elif isinstance(raw, dict):
            if "telemetry" in raw:
                inner = raw["telemetry"]
                df = pd.DataFrame(inner)
            else:
                df = pd.DataFrame(raw)
        else:
            return json.dumps({"error": "Telemetry must be a list of rows or dict of columns."}, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Failed to parse into DataFrame: {e}"}, indent=2)

    if len(df) < 60:
        return json.dumps({"error": f"Need ≥60 rows, got {len(df)}."}, indent=2)

    missing = [c for c in CONTEXT_COLS + SENSOR_COLS if c not in df.columns]
    if missing:
        return json.dumps({"error": f"Missing columns: {missing}"}, indent=2)

    health_history = raw.get("health_history") if isinstance(raw, dict) else None

    try:
        result = pipeline.predict(df, health_history=health_history)
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": f"Inference failed: {e}"}, indent=2)


with gr.Blocks(title="R2 UAV Engine ML Service", theme=gr.themes.Soft()) as demo:
    gr.Markdown(
        """
        # 🛩️ R2 UAV Engine Health Monitoring — ML Inference Service

        **REST API endpoints:**
        - `GET /health` — Keep-alive & readiness check
        - `GET /schema` — Required telemetry columns
        - `POST /predict` — Full diagnostic inference
        """
    )
    with gr.Row():
        inp = gr.Textbox(
            label="Telemetry JSON (≥60 rows with 5 context + 19 sensor columns)",
            lines=8,
            placeholder='{"telemetry": [{"throttle_pct": 75, "alt_m": 1200, ...}, ...]}',
        )
        out = gr.Textbox(label="Diagnostic Result", lines=16)
    btn = gr.Button("Run Inference", variant="primary")
    btn.click(fn=gradio_predict, inputs=inp, outputs=out)


# ── 6. Mount Gradio to FastAPI ─────────────────────────────────────────
app = gr.mount_gradio_app(app, demo, path="/")


# ── 7. Server Entry Point ──────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
