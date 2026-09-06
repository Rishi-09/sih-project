"""
Configuration parameters for Retribution: Engine Ops Server & Simulation Loop.
"""

from pathlib import Path
from typing import Dict, Any

# Network ports (Isolated from 3D game)
OPS_WS_PORT: int = 8766
OPS_HTTP_PORT: int = 3001

# Timing Architecture
INNER_TICK_HZ: int = 20           # 20 Hz inner loop rate (50ms interval)
DEFAULT_SPEED_MULTIPLIER: float = 1.0  # 1.0x realtime
MAX_INPUT_RATE_HZ: int = 120      # Packet rate limiting guard

# ML Inference Configuration
ML_WINDOW_SIZE: int = 60          # 60 rows minimum required
ML_INFERENCE_INTERVAL_SIM_S: float = 5.0  # Predict every 5 accumulated sim seconds
MAX_TELEMETRY_BUFFER: int = 3600  # Cap buffer at 3600 frames

# File paths
BASE_DIR = Path(__file__).resolve().parent.parent
ENGINE_OPS_DIR = BASE_DIR / "engine_ops"

# Biomes definitions (Driven directly by player selection in 2D mode)
BIOMES: Dict[str, Dict[str, Any]] = {
    "normal": {
        "id": "normal",
        "name": "Base Airfield",
        "description": "Standard atmospheric conditions. ISA baseline calibration.",
        "base_oat_c": 20.0,
        "vib_extra": 0.0,
        "volt_noise": 0.0,
        "accent_color": "#00d4ff",
    },
    "desert": {
        "id": "desert",
        "name": "Thar Desert Zone",
        "description": "Extreme ambient heat (+48°C). Stresses liquid cooling, CHTs, and oil breakdown.",
        "base_oat_c": 48.0,
        "vib_extra": 0.02,
        "volt_noise": 0.0,
        "accent_color": "#f59e0b",
    },
    "arctic": {
        "id": "arctic",
        "name": "Himalayan Ridge (Arctic)",
        "description": "Extreme sub-zero cold (-30°C). Stresses oil viscosity and cold startup thermal curves.",
        "base_oat_c": -30.0,
        "vib_extra": 0.01,
        "volt_noise": 0.0,
        "accent_color": "#38bdf8",
    },
    "storm": {
        "id": "storm",
        "name": "Monsoon Thunderstorm Cell",
        "description": "Heavy turbulence and lightning. Induces mechanical vibration and electrical bus EMI.",
        "base_oat_c": 16.0,
        "vib_extra": 0.22,
        "volt_noise": 0.45,
        "accent_color": "#a855f7",
    },
    "high_alt": {
        "id": "high_alt",
        "name": "Stratospheric Ceiling",
        "description": "High altitude thin air (>4800m). Exceeds TCU critical altitude; induction MAP drops.",
        "base_oat_c": -15.0,
        "vib_extra": 0.03,
        "volt_noise": 0.0,
        "accent_color": "#ec4899",
    }
}

# Physical bounds
SERVICE_CEILING_M: float = 6500.0
TCU_CRITICAL_ALTITUDE_M: float = 4800.0
