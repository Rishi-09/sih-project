"""
FastAPI Microservice for R2 UAV Engine ML Inference.

Endpoints:
- GET  /health   -> Health check & keep-alive target (24h ping prevents Space sleeping)
- GET  /schema   -> Telemetry input columns and subsystem mapping
- POST /predict  -> Predict health index, subsystem scores, fault classification, anomaly detection, and RUL
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
import pandas as pd
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine_pipeline import (
    CONTEXT_COLS,
    SENSOR_COLS,
    PHASE_CATEGORIES,
    SUBSYSTEM_MAP,
    get_pipeline,
    EngineHealthPipeline,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load pipeline into memory on startup
    try:
        pipeline = get_pipeline()
        print(f"[ML API] Pipeline models loaded successfully into memory.")
    except Exception as e:
        print(f"[ML API] Warning: Failed to pre-load pipeline models: {e}")
    yield


app = FastAPI(
    title="R2 UAV Engine Health Monitoring ML API",
    description="Real-time predictive diagnostics, nominal twin telemetry, 91-class fault classification, anomaly detection, and RUL prognosis.",
    version="1.1.0",
    lifespan=lifespan,
)

# Enable CORS for cross-origin frontend or Railway server access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    telemetry: Union[List[Dict[str, Any]], Dict[str, List[Any]]] = Field(
        ...,
        description="At least 60 rows of engine telemetry. Can be a list of row dicts or a dict of column arrays.",
    )
    health_history: Optional[List[float]] = Field(
        None,
        description="Optional list of historical health scores for RUL slope extrapolation.",
    )


class HealthResponse(BaseModel):
    status: str = "ok"
    models_loaded: bool = True
    service: str = "r2-uav-engine-ml"
    timestamp: str


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check and keep-alive ping endpoint.
    Called every 24 hours by Railway twin-server to prevent Hugging Face Space from idling.
    """
    pipeline = get_pipeline()
    models_ready = pipeline.twin_bundle is not None and pipeline.fault_classifier is not None
    return HealthResponse(
        status="ok",
        models_loaded=models_ready,
        service="r2-uav-engine-ml",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/schema")
async def get_schema():
    """Returns the expected telemetry input schema and sensor definitions."""
    return {
        "required_context_columns": CONTEXT_COLS,
        "required_sensor_columns": SENSOR_COLS,
        "total_required_columns": len(CONTEXT_COLS) + len(SENSOR_COLS),
        "minimum_window_rows": 60,
        "flight_phases": PHASE_CATEGORIES,
        "subsystems": SUBSYSTEM_MAP,
    }


@app.post("/predict")
async def run_predict(req: PredictRequest):
    """
    Run end-to-end diagnostic inference on a 60-second telemetry window.
    """
    pipeline = get_pipeline()

    try:
        if isinstance(req.telemetry, list):
            df = pd.DataFrame(req.telemetry)
        elif isinstance(req.telemetry, dict):
            df = pd.DataFrame(req.telemetry)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Telemetry must be a list of row records or a dictionary of column series.",
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse telemetry into tabular format: {e}",
        )

    if len(df) < 60:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Telemetry window requires at least 60 rows (got {len(df)} rows).",
        )

    # Check for missing required columns
    missing_ctx = [c for c in CONTEXT_COLS if c not in df.columns]
    missing_sns = [s for s in SENSOR_COLS if s not in df.columns]
    if missing_ctx or missing_sns:
        missing_all = missing_ctx + missing_sns
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required columns in telemetry: {missing_all}",
        )

    try:
        result = pipeline.predict(df, health_history=req.health_history)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference execution failed: {e}",
        )


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False)

