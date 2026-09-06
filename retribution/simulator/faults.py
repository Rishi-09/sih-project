"""
Fault injection engine for Rotax 915 iS A / iSC A engine simulator.
Injects faults onto independently sampled channels (EGT, Coolant, Oil, MAP, Fuel, Electrical, Mech).
Derived CHT 1..4 automatically inherit fault signatures via the §0 derivation formula:
  cht_k = coolant_temp_c + 25 + 0.3*(fuel_flow_lph - 12) + 0.15*(egt_k - mean(egt_1..4))
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from .config import Rotax915Config, DEFAULT_CONFIG

def compute_derived_cht(coolant_temp_c: float, fuel_flow_lph: float, egts: List[float]) -> List[float]:
    """Computes derived CHT for all 4 cylinders per CONTEXT.md Revision 3."""
    mean_egt = float(np.mean(egts))
    return [
        float(coolant_temp_c + 25.0 + 0.3 * (fuel_flow_lph - 12.0) + 0.15 * (egts[k] - mean_egt))
        for k in range(4)
    ]


class FaultType(str, Enum):
    NONE = "healthy"
    LUBRICATION_DEGRADATION = "lubrication_degradation"
    COOLING_FAILURE = "cooling_failure"
    IGNITION_FAULT_CYL3 = "ignition_fault_cyl3"
    INDUCTION_LOSS = "induction_loss"
    BEARING_WEAR = "bearing_wear"
    FUEL_SYSTEM_DEGRADATION = "fuel_system_degradation"
    INJECTOR_FAULT_CYL3 = "injector_fault_cyl3"
    ELECTRICAL_DEGRADATION = "electrical_degradation"
    SENSOR_FREEZE_COOLANT = "sensor_freeze_coolant"
    SENSOR_DRIFT_OILPRESS = "sensor_drift_oilpress"


@dataclass
class ChannelFaultProfile:
    """Defines how a specific sensor channel is altered by a fault."""
    delay_s: float                    # Delay in seconds from fault onset
    ramp_duration_s: float            # Time to ramp from 0 to full severity
    delta_val: float = 0.0            # Additive offset at severity = 1.0
    gain_multiplier: float = 1.0      # Multiplicative gain at severity = 1.0
    shape: str = "linear"             # "linear", "exponential", "step", "freeze"
    freeze_val: Optional[float] = None # Value to freeze at if shape == "freeze"

    def compute_effect(self, elapsed_s: float, severity: float) -> Tuple[float, float]:
        if elapsed_s < self.delay_s:
            return 0.0, 1.0

        t_active = elapsed_s - self.delay_s
        progress = min(1.0, t_active / max(0.1, self.ramp_duration_s))

        if self.shape == "step":
            factor = 1.0
        elif self.shape == "exponential":
            factor = (np.exp(3.0 * progress) - 1.0) / (np.exp(3.0) - 1.0)
        else:  # linear
            factor = progress

        applied_factor = factor * float(np.clip(severity, 0.0, 1.0))
        delta = self.delta_val * applied_factor
        gain = 1.0 + (self.gain_multiplier - 1.0) * applied_factor
        return delta, gain


@dataclass
class ActiveFault:
    """An instance of an active injected fault."""
    fault_type: str
    severity: float
    onset_time_s: float
    profiles: Dict[str, ChannelFaultProfile] = field(default_factory=dict)
    frozen_channel_values: Dict[str, float] = field(default_factory=dict)


class FaultManager:
    """
    Manages active faults, multi-fault superposition rules, and t_to_redline ground truth.
    """
    def __init__(self, config: Rotax915Config = DEFAULT_CONFIG):
        self.cfg = config
        self.active_faults: List[ActiveFault] = []

    def _build_profiles(self, fault_type: str) -> Dict[str, ChannelFaultProfile]:
        """Defines the physically realistic cascade on independently-sampled channels."""
        profiles: Dict[str, ChannelFaultProfile] = {}

        if fault_type in (FaultType.LUBRICATION_DEGRADATION, "lubrication_degradation"):
            # 1. Oil pressure drops first (t=0s)
            profiles["oil_press_bar"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=60.0, delta_val=-2.2, shape="linear")
            # 2. Oil temp rises ~60s later as friction increases
            profiles["oil_temp_c"] = ChannelFaultProfile(delay_s=60.0, ramp_duration_s=80.0, delta_val=+32.0, shape="linear")
            # 3. Coolant temp rises mildly ~120s later (CHTs follow coolant automatically!)
            profiles["coolant_temp_c"] = ChannelFaultProfile(delay_s=120.0, ramp_duration_s=90.0, delta_val=+14.0, shape="linear")
            # 4. Vibration rises last (t=180s)
            profiles["vib_rms_g"] = ChannelFaultProfile(delay_s=180.0, ramp_duration_s=60.0, delta_val=+0.45, shape="linear")

        elif fault_type in (FaultType.COOLING_FAILURE, "cooling_failure"):
            # 1. Coolant temp rises steadily toward 120°C limit (t=0s)
            # CHTs rise uniformly with coolant_temp_c automatically via the formula!
            profiles["coolant_temp_c"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=45.0, delta_val=+38.0, shape="linear")
            # 2. Oil temp climbs slowly as block overheats
            profiles["oil_temp_c"] = ChannelFaultProfile(delay_s=60.0, ramp_duration_s=120.0, delta_val=+18.0, shape="linear")

        elif fault_type in (FaultType.IGNITION_FAULT_CYL3, "ignition_fault_cyl3"):
            # Misfire: Cylinder 3 EGT DROPS immediately (-280°C)
            # CHT_3 drops automatically via egt_3 deviation in formula!
            profiles["egt_3"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=5.0, delta_val=-280.0, shape="step")
            profiles["rpm"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=10.0, delta_val=-180.0, shape="linear")
            profiles["vib_rms_g"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=15.0, delta_val=+0.22, shape="step")

        elif fault_type in (FaultType.INJECTOR_FAULT_CYL3, "injector_fault_cyl3"):
            # Injector Abnormality: Cylinder 3 runs LEAN -> EGT RISES (+95°C, opposite from ignition!)
            # CHT_3 rises automatically via egt_3 deviation in formula!
            profiles["egt_3"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=15.0, delta_val=+95.0, shape="linear")
            profiles["inj_timing_deg"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=10.0, delta_val=+3.5, shape="linear")
            profiles["vib_rms_g"] = ChannelFaultProfile(delay_s=10.0, ramp_duration_s=25.0, delta_val=+0.12, shape="linear")

        elif fault_type in (FaultType.INDUCTION_LOSS, "induction_loss"):
            # 1. MAP drops below TCU target (t=0s)
            profiles["map_kpa"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=20.0, delta_val=-38.0, shape="linear")
            # 2. Fuel flow drops
            profiles["fuel_flow_lph"] = ChannelFaultProfile(delay_s=5.0, ramp_duration_s=20.0, delta_val=-9.0, shape="linear")
            # 3. RPM droops
            profiles["rpm"] = ChannelFaultProfile(delay_s=10.0, ramp_duration_s=30.0, delta_val=-400.0, shape="linear")

        elif fault_type in (FaultType.BEARING_WEAR, "bearing_wear"):
            # 1. Vibration rises exponentially (t=0s)
            profiles["vib_rms_g"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=90.0, delta_val=+0.85, shape="exponential")
            # 2. Mechanical drag causes RPM roughness
            profiles["rpm"] = ChannelFaultProfile(delay_s=30.0, ramp_duration_s=60.0, delta_val=-140.0, shape="linear")
            # 3. Bearing friction elevates oil temp late
            profiles["oil_temp_c"] = ChannelFaultProfile(delay_s=60.0, ramp_duration_s=120.0, delta_val=+14.0, shape="linear")

        elif fault_type in (FaultType.FUEL_SYSTEM_DEGRADATION, "fuel_system_degradation"):
            # 1. Fuel rail pressure drops (t=0s)
            profiles["fuel_press_bar"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=25.0, delta_val=-0.70, shape="linear")
            # 2. Fuel flow restricts
            profiles["fuel_flow_lph"] = ChannelFaultProfile(delay_s=5.0, ramp_duration_s=30.0, delta_val=-7.5, shape="linear")
            # 3. Lean mixture causes all EGTs to spike
            for i in range(1, 5):
                profiles[f"egt_{i}"] = ChannelFaultProfile(delay_s=15.0, ramp_duration_s=35.0, delta_val=+85.0, shape="linear")

        elif fault_type in (FaultType.ELECTRICAL_DEGRADATION, "electrical_degradation", "alternator_failure"):
            # Alternator output drops to 0 A -> bus voltage slowly discharges
            profiles["alt_current_a"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=2.0, delta_val=-30.0, shape="step")
            profiles["bus_voltage_v"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=30.0, delta_val=-2.5, shape="linear")

        elif fault_type in (FaultType.SENSOR_DRIFT_OILPRESS, "sensor_drift_oilpress", "sensor_drift"):
            # Isolated sensor calibration bias on oil_press_bar
            profiles["oil_press_bar"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=120.0, delta_val=-1.8, shape="linear")

        elif fault_type in (FaultType.SENSOR_FREEZE_COOLANT, "sensor_freeze_coolant", "sensor_freeze"):
            # Sensor freeze on independently-sampled coolant_temp_c
            profiles["coolant_temp_c"] = ChannelFaultProfile(delay_s=0.0, ramp_duration_s=1.0, shape="freeze")

        return profiles

    def inject_fault(self, fault_type: str, severity: float, current_time_s: float, onset_delay: float = 0.0):
        onset_time = current_time_s + onset_delay
        profiles = self._build_profiles(fault_type)
        active = ActiveFault(
            fault_type=fault_type,
            severity=float(np.clip(severity, 0.0, 1.0)),
            onset_time_s=onset_time,
            profiles=profiles
        )
        self.active_faults.append(active)

    def apply_faults(self, current_time_s: float, nominal_values: Dict[str, float]) -> Dict[str, float]:
        """
        Apply active faults to independently sampled channels, then re-derive CHT 1..4.
        """
        modified = dict(nominal_values)
        if not self.active_faults:
            egts = [modified.get(f"egt_{i}", 800.0) for i in range(1, 5)]
            chts = compute_derived_cht(modified.get("coolant_temp_c", 85.0), modified.get("fuel_flow_lph", 22.0), egts)
            for i, c in enumerate(chts):
                modified[f"cht_{i+1}"] = c
            return modified

        total_deltas: Dict[str, float] = {k: 0.0 for k in nominal_values if not k.startswith("cht_")}
        total_gains: Dict[str, float] = {k: 1.0 for k in nominal_values if not k.startswith("cht_")}
        frozen_channels: Dict[str, float] = {}

        for fault in self.active_faults:
            if current_time_s < fault.onset_time_s:
                continue
            elapsed = current_time_s - fault.onset_time_s
            for channel, profile in fault.profiles.items():
                if channel in total_deltas:
                    if profile.shape == "freeze":
                        if channel not in fault.frozen_channel_values:
                            fault.frozen_channel_values[channel] = modified[channel]
                        frozen_channels[channel] = fault.frozen_channel_values[channel]
                    else:
                        delta, gain = profile.compute_effect(elapsed, fault.severity)
                        total_deltas[channel] += delta
                        total_gains[channel] *= gain

        for channel in list(total_deltas.keys()):
            if channel in frozen_channels:
                modified[channel] = frozen_channels[channel]
            else:
                val = (modified[channel] * total_gains[channel]) + total_deltas[channel]
                if "press" in channel or "flow" in channel or channel in ("rpm", "vib_rms_g", "map_kpa", "alt_current_a"):
                    val = max(0.0, val)
                modified[channel] = float(val)

        # Derivation pass: recompute CHT 1..4 from faulted EGTs, coolant, and fuel flow
        egts = [modified.get(f"egt_{i}", 800.0) for i in range(1, 5)]
        coolant = modified.get("coolant_temp_c", 85.0)
        fuel_flow = modified.get("fuel_flow_lph", 22.0)
        chts = compute_derived_cht(coolant, fuel_flow, egts)
        for i, c in enumerate(chts):
            modified[f"cht_{i+1}"] = c

        return modified

    def compute_t_to_redline(self, current_time_s: float, nominal_values: Dict[str, float]) -> Optional[float]:
        """
        Computes exact ground truth seconds until the first sensor crosses its Rotax 915 iS redline limit.
        Returns None for healthy runs or sensor-fault-only runs.
        """
        active_now = [f for f in self.active_faults if current_time_s >= f.onset_time_s]
        if not active_now:
            return None

        engine_faults = [f for f in active_now if not f.fault_type.startswith("sensor_")]
        if not engine_faults:
            return None

        horizon_s = 1800.0  # Search up to 30 min ahead
        dt_sim = 5.0
        t_check = current_time_s

        while t_check <= current_time_s + horizon_s:
            projected = self.apply_faults(t_check, nominal_values)
            
            for channel, (limit_val, is_lower_bound) in self.cfg.redline_limits.items():
                if channel in projected:
                    val = projected[channel]
                    crossed = (val <= limit_val) if is_lower_bound else (val >= limit_val)
                    if crossed:
                        return float(max(0.0, t_check - current_time_s))
                        
            t_check += dt_sim

        return None

    def get_state(self, current_time_s: float) -> Dict[str, Any]:
        """Returns ground truth state dictionary."""
        active = [f for f in self.active_faults if current_time_s >= f.onset_time_s]
        if not active:
            return {
                "active_faults": [],
                "fault_label": "healthy",
                "severity": 0.0,
                "t_since_onset": 0.0,
            }
        
        labels = [f.fault_type for f in active]
        compound_label = "+".join(labels)
        max_severity = max(f.severity for f in active)
        t_since_onset = current_time_s - min(f.onset_time_s for f in active)
        
        return {
            "active_faults": labels,
            "fault_label": compound_label,
            "severity": float(max_severity),
            "t_since_onset": float(t_since_onset),
        }
