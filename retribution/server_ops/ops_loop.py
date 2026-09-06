"""
OpsSimulationLoop: 20 Hz Async Simulation Loop & Co-located ML Inference Engine for Engine Ops.
Broadcasts telemetry at 20 Hz, runs ML every 5.0 simulated seconds, and maintains resilient server-side state.
"""

import asyncio
import json
import logging
from collections import deque
from typing import Dict, Any, Set, Optional
import pandas as pd

from .config import (
    INNER_TICK_HZ, DEFAULT_SPEED_MULTIPLIER, ML_WINDOW_SIZE,
    ML_INFERENCE_INTERVAL_SIM_S, MAX_TELEMETRY_BUFFER
)
from .ops_engine import OpsEngineSim
from .ops_missions import MissionManager, MISSIONS
from pure_engine_ml import EngineHealthPipeline

logger = logging.getLogger("OpsSimulationLoop")


class OpsSimulationManager:
    """
    Manages 20 Hz simulation stepping, mission state, and WebSocket broadcasting for Engine Ops.
    """
    def __init__(self):
        self.engine = OpsEngineSim(seed=42)
        self.mission_mgr = MissionManager(self.engine)
        self.ml_pipeline: Optional[EngineHealthPipeline] = None
        self.buffer = deque(maxlen=MAX_TELEMETRY_BUFFER)
        
        # Runtime flags
        self.is_running = False
        self.is_paused = False
        self.speed_multiplier = DEFAULT_SPEED_MULTIPLIER
        self.active_subscribers: Set[Any] = set()
        self.loop_task: Optional[asyncio.Task] = None
        
        # ML timing tracking (in simulated seconds)
        self.last_ml_sim_time = 0.0
        
        # Last known states
        self.last_telemetry: Optional[Dict[str, Any]] = None
        self.last_ml_result: Optional[Dict[str, Any]] = None

    def initialize_ml(self):
        """Pre-load ML pipeline in memory."""
        try:
            logger.info("Loading EngineHealthPipeline for Engine Ops...")
            # "ops": normalise residuals against the OpsEngineSim calibration,
            # not the runs_v3 one the twin was fitted on. See
            # calibrate_ops_residuals.py for why that distinction matters here.
            self.ml_pipeline = EngineHealthPipeline(residual_domain="ops")
            logger.info("EngineHealthPipeline loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load ML pipeline: {e}. Running in telemetry-only mode.")
            self.ml_pipeline = None

    def start(self, speed: Optional[float] = None):
        """Start the 20 Hz simulation session."""
        if speed is not None:
            self.speed_multiplier = max(0.1, min(20.0, float(speed)))
            
        self.is_running = True
        self.is_paused = False
        if self.loop_task is None or self.loop_task.done():
            self.loop_task = asyncio.create_task(self._run_loop())
        logger.info(f"Engine Ops sim loop running at {INNER_TICK_HZ} Hz ({self.speed_multiplier}x speed).")

    def pause(self):
        self.is_paused = True
        logger.info("Engine Ops simulation paused.")

    def resume(self):
        self.is_paused = False
        logger.info("Engine Ops simulation resumed.")

    def set_speed(self, speed: float):
        self.speed_multiplier = max(0.1, min(20.0, float(speed)))
        logger.info(f"Engine Ops speed set to {self.speed_multiplier}x.")

    def reset(self, seed: Optional[int] = 42):
        self.engine = OpsEngineSim(seed=seed)
        self.mission_mgr = MissionManager(self.engine)
        self.buffer.clear()
        self.last_telemetry = None
        self.last_ml_result = None
        self.last_ml_sim_time = 0.0
        logger.info("Engine Ops state reset.")

    def set_player_input(self, control_data: Dict[str, Any]):
        """Forward player controls to engine context."""
        self.engine.set_player_input(control_data)

    def inject_fault(self, fault: str, severity: float, onset_delay: float = 0.0):
        self.engine.inject_fault(fault, severity, onset_delay)

    def clear_faults(self):
        self.engine.clear_faults()

    def start_mission(self, mission_id: int):
        self.mission_mgr.start_mission(mission_id)

    def abort_mission(self):
        self.mission_mgr.abort_mission()

    def register_client(self, websocket: Any):
        self.active_subscribers.add(websocket)
        logger.info(f"Client connected. Active clients: {len(self.active_subscribers)}")

    def unregister_client(self, websocket: Any):
        self.active_subscribers.discard(websocket)
        logger.info(f"Client disconnected. Active clients: {len(self.active_subscribers)}")

    def get_full_state_snapshot(self) -> Dict[str, Any]:
        """Produce full state snapshot for new/reconnecting clients."""
        return {
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "speed_multiplier": self.speed_multiplier,
            "inner_tick_hz": INNER_TICK_HZ,
            "missions": MISSIONS,
            "mission_state": self.mission_mgr.get_state(),
            "last_telemetry": self.last_telemetry,
            "last_ml_result": self.last_ml_result,
        }

    async def _broadcast(self, message_dict: Dict[str, Any]):
        """Broadcast JSON packet to all connected clients."""
        if not self.active_subscribers:
            return
            
        payload = json.dumps(message_dict)
        disconnected = []
        for ws in self.active_subscribers:
            try:
                await ws.send(payload)
            except Exception:
                disconnected.append(ws)
                
        for dead_ws in disconnected:
            self.active_subscribers.discard(dead_ws)

    async def _run_loop(self):
        """Fixed 20 Hz inner loop."""
        logger.info("20 Hz Engine Ops inner ticker active.")
        interval_s = 1.0 / INNER_TICK_HZ
        
        while self.is_running:
            if not self.is_paused:
                try:
                    # 1. Compute fractional simulated dt
                    dt_sim = self.speed_multiplier / INNER_TICK_HZ
                    
                    # 2. Advance physics frame
                    frame = self.engine.step(dt=dt_sim)
                    self.last_telemetry = frame
                    self.buffer.append(frame)
                    
                    # 3. Advance mission manager & broadcast mission events
                    mission_events = self.mission_mgr.step(dt=dt_sim, telemetry=frame)
                    
                    # 4. Broadcast 20 Hz telemetry frame with mission state
                    await self._broadcast({
                        "type": "telemetry",
                        "data": frame,
                        "mission": self.mission_mgr.get_state()
                    })
                    
                    # 5. Broadcast mission events
                    for event in mission_events:
                        await self._broadcast({
                            "type": "mission_event",
                            "data": event
                        })
                        
                    # 6. Broadcast redline violations
                    if frame.get("redline_violations"):
                        for violation in frame["redline_violations"]:
                            await self._broadcast({
                                "type": "redline_alert",
                                "data": violation
                            })

                    # 7. ML inference evaluated every 5.0 simulated seconds
                    sim_t = float(frame["t_s"])
                    if self.ml_pipeline is not None and (sim_t - self.last_ml_sim_time) >= ML_INFERENCE_INTERVAL_SIM_S:
                        self.last_ml_sim_time = sim_t
                        if len(self.buffer) >= ML_WINDOW_SIZE:
                            window_records = list(self.buffer)[-ML_WINDOW_SIZE:]
                            df_window = pd.DataFrame(window_records)
                            
                            try:
                                ml_result = self.ml_pipeline.predict(df_window)
                                self.last_ml_result = ml_result
                                await self._broadcast({
                                    "type": "ml_result",
                                    "data": ml_result
                                })
                            except Exception as ml_err:
                                logger.error(f"ML evaluation error: {ml_err}")

                except Exception as loop_err:
                    logger.error(f"Error in sim tick: {loop_err}", exc_info=True)

            # Fixed real-time 50ms pacing (20 Hz)
            await asyncio.sleep(interval_s)
