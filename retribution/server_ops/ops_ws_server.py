"""
OpsWSServer: Robust WebSocket Server for Retribution: Engine Ops.
Handles bi-directional commands with input validation, rate-limiting, and reconnect session recovery.
"""

import json
import logging
import math
import time
from typing import Any, Dict
import websockets
from websockets.server import WebSocketServerProtocol

from .config import BIOMES, MAX_INPUT_RATE_HZ, SERVICE_CEILING_M
from .ops_loop import OpsSimulationManager

logger = logging.getLogger("OpsWSServer")


class OpsWSServer:
    """
    WebSocket server for Engine Ops mode on port 8766.
    """
    def __init__(self, sim_manager: OpsSimulationManager, host: str = "0.0.0.0", port: int = 8766):
        self.sim = sim_manager
        self.host = host
        self.port = port
        self._client_packet_counters: Dict[Any, Dict[str, Any]] = {}

    def _validate_flight_input(self, controls: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize and clamp flight controls against NaN, Infinity, and invalid bounds.
        """
        sanitized: Dict[str, Any] = {}
        
        # Throttle clamp [0.0, 100.0]
        if "throttle" in controls:
            try:
                val = float(controls["throttle"])
                if not math.isnan(val) and not math.isinf(val):
                    sanitized["throttle"] = max(0.0, min(100.0, val))
            except (ValueError, TypeError):
                pass

        # Pitch clamp [-1.0, 1.0]
        if "pitch" in controls:
            try:
                val = float(controls["pitch"])
                if not math.isnan(val) and not math.isinf(val):
                    sanitized["pitch"] = max(-1.0, min(1.0, val))
            except (ValueError, TypeError):
                pass

        # Roll clamp [-1.0, 1.0]
        if "roll" in controls:
            try:
                val = float(controls["roll"])
                if not math.isnan(val) and not math.isinf(val):
                    sanitized["roll"] = max(-1.0, min(1.0, val))
            except (ValueError, TypeError):
                pass

        # Biome validation
        if "biome" in controls and controls["biome"] in BIOMES:
            sanitized["biome"] = str(controls["biome"])

        # Autopilot target altitude clamp [0.0, 6500.0]
        if "ap_target_alt" in controls:
            try:
                val = float(controls["ap_target_alt"])
                if not math.isnan(val) and not math.isinf(val):
                    sanitized["ap_target_alt"] = max(0.0, min(SERVICE_CEILING_M, val))
            except (ValueError, TypeError):
                pass

        # Boolean flags
        for flag in ("flaps", "gear", "autopilot"):
            if flag in controls and controls[flag] is not None:
                sanitized[flag] = bool(controls[flag])

        return sanitized

    def _check_rate_limit(self, websocket: Any) -> bool:
        """Rate limit incoming packets to MAX_INPUT_RATE_HZ."""
        now = time.time()
        counter = self._client_packet_counters.setdefault(websocket, {"sec": int(now), "count": 0})
        
        curr_sec = int(now)
        if curr_sec != counter["sec"]:
            counter["sec"] = curr_sec
            counter["count"] = 1
            return True
        else:
            counter["count"] += 1
            return counter["count"] <= MAX_INPUT_RATE_HZ

    async def handle_connection(self, websocket: WebSocketServerProtocol):
        """Handle client lifecycle, initial state sync, and message dispatching."""
        self.sim.register_client(websocket)
        
        # Send full initial state snapshot for reconnects / fresh sessions
        try:
            init_msg = {
                "type": "init_state",
                "data": self.sim.get_full_state_snapshot()
            }
            await websocket.send(json.dumps(init_msg))
            
            async for raw_msg in websocket:
                if not self._check_rate_limit(websocket):
                    continue  # Silently drop flood packets
                    
                try:
                    data = json.loads(raw_msg)
                    msg_type = data.get("type", "")
                    
                    if msg_type == "flight_input":
                        raw_controls = data.get("controls", {})
                        clean_controls = self._validate_flight_input(raw_controls)
                        if clean_controls:
                            self.sim.set_player_input(clean_controls)
                            
                    elif msg_type == "start_mission":
                        mission_id = int(data.get("mission_id", 1))
                        self.sim.start_mission(mission_id)
                        
                    elif msg_type == "abort_mission":
                        self.sim.abort_mission()
                        
                    elif msg_type == "inject_fault":
                        fault_name = str(data.get("fault", ""))
                        severity = float(data.get("severity", 0.5))
                        delay = float(data.get("delay", 0.0))
                        self.sim.inject_fault(fault_name, severity, delay)
                        
                    elif msg_type == "clear_faults":
                        self.sim.clear_faults()
                        
                    elif msg_type == "set_speed":
                        speed = float(data.get("speed", 1.0))
                        self.sim.set_speed(speed)
                        
                    elif msg_type == "pause":
                        self.sim.pause()
                        
                    elif msg_type == "resume":
                        self.sim.resume()
                        
                    elif msg_type == "reset":
                        seed = int(data.get("seed", 42))
                        self.sim.reset(seed=seed)
                        
                except json.JSONDecodeError:
                    logger.warning("Received invalid JSON payload from client.")
                except Exception as err:
                    logger.error(f"Error processing client message: {err}", exc_info=True)
                    
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._client_packet_counters.pop(websocket, None)
            self.sim.unregister_client(websocket)

    async def start(self):
        """Start listening for WebSocket connections."""
        logger.info(f"Engine Ops WebSocket server starting on ws://{self.host}:{self.port} ...")
        return await websockets.serve(self.handle_connection, self.host, self.port)
