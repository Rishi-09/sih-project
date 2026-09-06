"""
Configuration and specifications for the Rotax 915 iS A / iSC A Turbocharged & Fuel-Injected Aero Engine.
All limits derived directly from BRP-Rotax 915 iS Operator Manual with physics-estimated CHT channels.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# 5 Flight Context Channels (Layer 1)
CONTEXT_CHANNELS: List[str] = [
    "throttle_pct",  # Throttle lever position (0 - 100%)
    "alt_m",         # Altitude in meters above sea level
    "oat_c",         # Outside air temperature in deg C (ISA lapse rate)
    "ias_kt",        # Indicated airspeed in knots
    "phase",         # Flight phase (STARTUP, TAXI, TAKEOFF, CLIMB, CRUISE, LOITER, DESCENT, APPROACH, SHUTDOWN)
]

# 19 Engine Telemetry Channels (Layer 2)
# 15 Measured Sensors + 4 Physics-Estimated CHT channels
SENSOR_CHANNELS: List[str] = [
    # Mechanical Subsystem (2) - Measured
    "rpm",             # Engine rotational speed (RPM)
    "vib_rms_g",       # Engine block vibration RMS (g)
    
    # Combustion Subsystem (4) - Measured
    "egt_1",           # Exhaust Gas Temp 1 (°C)
    "egt_2",           # Exhaust Gas Temp 2 (°C)
    "egt_3",           # Exhaust Gas Temp 3 (°C)
    "egt_4",           # Exhaust Gas Temp 4 (°C)
    
    # Cooling Subsystem (5) - 1 Measured Coolant Probe + 4 Estimated CHTs
    "cht_1",           # Cylinder Head Temp 1 (°C) - Estimated
    "cht_2",           # Cylinder Head Temp 2 (°C) - Estimated
    "cht_3",           # Cylinder Head Temp 3 (°C) - Estimated
    "cht_4",           # Cylinder Head Temp 4 (°C) - Estimated
    "coolant_temp_c",  # Coolant temperature (°C) - Measured
    
    # Lubrication Subsystem (2) - Measured
    "oil_press_bar",   # Oil pressure (bar)
    "oil_temp_c",      # Oil temperature (°C)
    
    # Induction & Fuel Subsystem (4) - Measured
    "map_kpa",         # Manifold Absolute Pressure (kPa)
    "fuel_flow_lph",   # Fuel flow rate (L/h)
    "fuel_press_bar",  # Fuel rail pressure (bar)
    "inj_timing_deg",  # Electronic Injection / Ignition timing (°BTDC)
    
    # Electrical Subsystem (2) - Measured
    "bus_voltage_v",   # Avionics / Engine DC Bus Voltage (V)
    "alt_current_a",   # Alternator Output Current (A)
]

ALL_COLUMNS: List[str] = ["t_s"] + CONTEXT_CHANNELS + SENSOR_CHANNELS + ["fault_label", "severity", "t_to_redline"]

# Channel Source Metadata: "measured" vs "estimated"
CHANNEL_SOURCE: Dict[str, str] = {
    "throttle_pct": "measured",
    "alt_m": "measured",
    "oat_c": "measured",
    "ias_kt": "measured",
    "phase": "derived",
    "rpm": "measured",
    "vib_rms_g": "measured",
    "egt_1": "measured",
    "egt_2": "measured",
    "egt_3": "measured",
    "egt_4": "measured",
    "cht_1": "estimated",
    "cht_2": "estimated",
    "cht_3": "estimated",
    "cht_4": "estimated",
    "coolant_temp_c": "measured",
    "oil_press_bar": "measured",
    "oil_temp_c": "measured",
    "map_kpa": "measured",
    "fuel_flow_lph": "measured",
    "fuel_press_bar": "measured",
    "inj_timing_deg": "measured",
    "bus_voltage_v": "measured",
    "alt_current_a": "measured",
}

# Subsystem Mappings (6 Subsystems - used by Digital Twin Health Index and ML pipeline)
SUBSYSTEMS: Dict[str, List[str]] = {
    "lubrication":    ["oil_press_bar", "oil_temp_c"],
    "cooling":        ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
    "combustion":     ["egt_1", "egt_2", "egt_3", "egt_4"],
    "induction_fuel": ["map_kpa", "fuel_press_bar", "fuel_flow_lph", "inj_timing_deg"],
    "mechanical":     ["vib_rms_g", "rpm"],
    "electrical":     ["bus_voltage_v", "alt_current_a"],
}

@dataclass
class Rotax915Config:
    """Official operating limits and physics constants for Rotax 915 iS A / iSC A."""
    # RPM limits
    rpm_idle: float = 1400.0
    rpm_max_continuous: float = 5500.0
    rpm_max_takeoff: float = 5800.0
    rpm_redline: float = 5850.0
    
    # CHT limits (°C) - Physics estimated (adapted from 912/914 docs with 150°C liquid-cooled ceiling)
    cht_normal_min: float = 80.0
    cht_normal_max: float = 110.0
    cht_caution_max: float = 135.0
    cht_redline: float = 150.0

    # Coolant temperature limits (°C) - Measured in coolant jacket
    coolant_normal_min: float = 70.0
    coolant_normal_max: float = 105.0
    coolant_caution_max: float = 115.0
    coolant_redline: float = 120.0
    
    # EGT limits (°C) - Measured
    egt_normal_min: float = 750.0
    egt_normal_max: float = 850.0
    egt_caution_max: float = 880.0
    egt_redline: float = 950.0
    
    # Oil temperature limits (°C)
    oil_temp_min: float = 50.0
    oil_temp_normal_min: float = 90.0
    oil_temp_normal_max: float = 110.0
    oil_temp_caution_max: float = 125.0
    oil_temp_redline: float = 130.0
    
    # Oil pressure limits (bar)
    oil_press_min_idle: float = 0.8
    oil_press_min_continuous: float = 1.5
    oil_press_normal_min: float = 2.0
    oil_press_normal_max: float = 5.0
    oil_press_max: float = 7.0
    oil_press_redline_low: float = 1.5
    oil_press_redline_high: float = 7.0
    
    # Fuel rail pressure (bar) on EFI system
    fuel_press_nominal: float = 3.0
    fuel_press_min: float = 2.8
    fuel_press_max: float = 3.2
    fuel_press_peak_max: float = 3.5
    fuel_press_redline_low: float = 2.2
    fuel_press_redline_high: float = 3.8
    
    # Fuel flow (L/h)
    fuel_flow_idle: float = 5.0
    fuel_flow_cruise_eco: float = 19.0
    fuel_flow_cruise_fast: float = 27.0
    fuel_flow_takeoff: float = 38.0
    
    # Manifold pressure (kPa) & Turbocharger TCU parameters
    map_idle: float = 35.0
    map_cruise: float = 101.3
    map_max_continuous: float = 135.0
    map_takeoff_boost: float = 154.0
    critical_altitude_m: float = 4800.0  # TCU maintains constant MAP up to 4800m
    
    # Engine block vibration (g RMS)
    vib_normal_min: float = 0.05
    vib_normal_max: float = 0.25
    vib_caution: float = 0.50
    vib_redline: float = 1.00

    # Electrical limits (14V system)
    bus_voltage_nominal: float = 14.2
    bus_voltage_min: float = 12.0
    bus_voltage_caution: float = 12.8
    bus_voltage_redline_low: float = 11.5
    alt_current_nominal: float = 25.0
    alt_current_max: float = 40.0

    # Injection / Ignition timing (°BTDC)
    inj_timing_nominal: float = 26.0

    # Redline mapping for t_to_redline calculation: channel -> (threshold, is_lower_bound)
    redline_limits: Dict[str, Tuple[float, bool]] = field(default_factory=lambda: {
        "cht_1": (150.0, False),
        "cht_2": (150.0, False),
        "cht_3": (150.0, False),
        "cht_4": (150.0, False),
        "coolant_temp_c": (120.0, False),
        "egt_1": (950.0, False),
        "egt_2": (950.0, False),
        "egt_3": (950.0, False),
        "egt_4": (950.0, False),
        "oil_temp_c": (130.0, False),
        "oil_press_bar": (1.5, True),
        "fuel_press_bar": (2.2, True),
        "vib_rms_g": (1.0, False),
        "rpm": (5850.0, False),
        "bus_voltage_v": (11.5, True),
    })

DEFAULT_CONFIG = Rotax915Config()
Rotax914Config = Rotax915Config
