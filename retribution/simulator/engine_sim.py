"""
Core EngineSim class and offline simulation runner.
Implements the exact frozen interface required by ML and Backend teams.
Integrates:
- Flight Context Layer (Layer 1)
- Nominal Sensor Physics & Thermal Capacitance Network (Layer 2)
- Fault Injection & Multi-Fault Overlay (Layer 3)
- Realistic Avionics Noise, ADC Quantization, and CAN bus handling
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd

from .config import Rotax914Config, DEFAULT_CONFIG, ALL_COLUMNS, CONTEXT_CHANNELS, SENSOR_CHANNELS
from .context import MissionProfile, KinematicContextGenerator, JSBSimContextGenerator
from .thermal import SensorLagBank, CorrelatedNoiseEngine
from .sensors import NominalSensorModel
from .faults import FaultManager, FaultType


class EngineSim:
    """
    Rotax 915 iS Engine Sensor Simulator.
    Generates second-by-second readings for 19 engine sensors + 5 context channels
    under nominal conditions or with injected single/compound fault cascades.
    """
    def __init__(
        self,
        profile: Optional[MissionProfile] = None,
        seed: Optional[int] = 42,
        use_jsbsim: bool = False,
        config: Rotax914Config = DEFAULT_CONFIG
    ):
        self.profile = profile or MissionProfile()
        self.seed = seed
        self.cfg = config
        self.t_s = 0.0

        # Sub-modules
        if use_jsbsim:
            self.context_gen = JSBSimContextGenerator(self.profile, seed=seed)
        else:
            self.context_gen = KinematicContextGenerator(self.profile, seed=seed)

        self.sensor_model = NominalSensorModel(self.cfg)
        self.lag_bank = SensorLagBank()
        self.noise_engine = CorrelatedNoiseEngine(seed=seed)
        self.fault_mgr = FaultManager(self.cfg)
        self.is_initialized = False

    def inject_fault(self, fault: str, severity: float, onset_delay: float = 0.0):
        """
        Inject a fault into the engine.
        Supports single faults and multiple simultaneous faults.
        """
        self.fault_mgr.inject_fault(
            fault_type=fault,
            severity=severity,
            current_time_s=self.t_s,
            onset_delay=onset_delay
        )

    def state(self) -> Dict[str, Any]:
        """Returns current ground-truth engine and fault state."""
        return self.fault_mgr.get_state(self.t_s)

    def step(self) -> Dict[str, Any]:
        """
        Advance simulation by 1 second.
        Returns dictionary containing all 5 context channels, 19 sensor channels,
        and ground truth fault metadata.
        """
        # 1. Advance Context Layer (Layer 1)
        context = self.context_gen.step()
        self.t_s = context["t_s"]

        # 2. Compute Nominal Steady-State Targets (Layer 2)
        nominal_targets = self.sensor_model.compute_nominal_targets(context)

        # Initialize lag filters on first step
        if not self.is_initialized:
            self.lag_bank.initialize(nominal_targets)
            self.is_initialized = True

        # Apply Thermal & Hydraulic Lag Dynamics (Differential Network)
        lagged_sensors = self.lag_bank.apply(nominal_targets, context=context)

        # 3. Apply Fault Overlay (Layer 3) with Multi-Fault Composition Rule
        faulted_sensors = self.fault_mgr.apply_faults(self.t_s, lagged_sensors)

        # 4. Add Correlated Sensor Noise & Realism (1/f pink noise + ADC quantization + EMI)
        current_rpm = float(faulted_sensors.get("rpm", 5000.0))
        noise = self.noise_engine.generate(rpm=current_rpm, t_s=self.t_s)
        
        final_sensors: Dict[str, float] = {}
        for ch in SENSOR_CHANNELS:
            raw_val = faulted_sensors.get(ch, 0.0) + noise.get(ch, 0.0)
            
            # Physical limit safety bounds
            if "press" in ch or "flow" in ch or ch in ("rpm", "vib_rms_g", "map_kpa", "alt_current_a"):
                raw_val = max(0.0, raw_val)
                
            # ADC Quantization pass
            quantized_val = self.noise_engine.quantize(ch, raw_val)
            
            # CAN dropout pass (ZOH)
            final_val = self.noise_engine.check_can_dropout(ch, quantized_val)
            final_sensors[ch] = round(float(final_val), 3)

        # 5. Compute Ground Truth RUL / Redline Status
        fault_state = self.fault_mgr.get_state(self.t_s)
        t_to_redline = self.fault_mgr.compute_t_to_redline(self.t_s, lagged_sensors)

        frame: Dict[str, Any] = {
            "t_s": float(self.t_s),
            "throttle_pct": round(float(context["throttle_pct"]), 2),
            "alt_m": round(float(context["alt_m"]), 2),
            "oat_c": round(float(context["oat_c"]), 2),
            "ias_kt": round(float(context["ias_kt"]), 2),
            "phase": str(context["phase"]),
            **final_sensors,
            "fault_label": str(fault_state["fault_label"]),
            "severity": float(fault_state["severity"]),
            "t_to_redline": float(t_to_redline) if t_to_redline is not None else None,
        }

        return frame

    def is_finished(self) -> bool:
        """Check if mission trajectory has concluded."""
        return self.context_gen.is_finished()


def simulate_run(
    profile: Optional[MissionProfile] = None,
    seed: Optional[int] = 42,
    faults: Optional[List[Tuple[str, float, float]]] = None,
    use_jsbsim: bool = False,
    max_duration_s: Optional[float] = None
) -> pd.DataFrame:
    """
    Offline helper to simulate a complete flight run and return a pandas DataFrame.
    
    Args:
        profile: Mission trajectory configuration
        seed: Random seed for deterministic reproducibility
        faults: List of (fault_type, severity, onset_time_s) tuples
        use_jsbsim: Whether to use JSBSim FDM
        max_duration_s: Optional cutoff time in seconds
    """
    sim = EngineSim(profile=profile, seed=seed, use_jsbsim=use_jsbsim)
    
    # Pre-inject scheduled faults
    if faults:
        for fault_type, severity, onset_time in faults:
            sim.inject_fault(fault_type, severity, onset_delay=onset_time)

    records = []
    while not sim.is_finished():
        frame = sim.step()
        records.append(frame)
        if max_duration_s and frame["t_s"] >= max_duration_s:
            break

    df = pd.DataFrame(records)
    return df
