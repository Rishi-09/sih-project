"""
Retribution Aero Piston Engine Digital Twin Simulator (Rotax 914 UL/F).
Designed for MALE UAV Health Monitoring & Fault Prediction.
"""

from .config import Rotax914Config, SUBSYSTEMS, SENSOR_CHANNELS, CONTEXT_CHANNELS
from .context import MissionProfile, JSBSimContextGenerator, KinematicContextGenerator
from .engine_sim import EngineSim, simulate_run
from .faults import FaultType, FaultManager
from .scenarios import get_canned_scenario, list_scenarios, SCENARIOS

__all__ = [
    "EngineSim",
    "simulate_run",
    "MissionProfile",
    "JSBSimContextGenerator",
    "KinematicContextGenerator",
    "Rotax914Config",
    "SUBSYSTEMS",
    "SENSOR_CHANNELS",
    "CONTEXT_CHANNELS",
    "FaultType",
    "FaultManager",
    "get_canned_scenario",
    "list_scenarios",
    "SCENARIOS",
]
