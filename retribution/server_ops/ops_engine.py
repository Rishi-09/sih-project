"""
OpsEngineSim: 4-Layer Rotax 915 iS Engine Simulator for the 2D Engine Operations Game.
Uses the existing simulator physics modules (NominalSensorModel, SensorLagBank, FaultManager, CorrelatedNoiseEngine)
with sub-second fractional dt support.
"""

from typing import Dict, Any, Optional, List
import numpy as np

from simulator.config import (
    Rotax915Config, DEFAULT_CONFIG, SENSOR_CHANNELS
)
from simulator.sensors import NominalSensorModel
from simulator.thermal import SensorLagBank, CorrelatedNoiseEngine
from simulator.faults import FaultManager
from .ops_context import OpsContextGenerator


class OpsEngineSim:
    """
    Real-time Rotax 915 iS engine simulator for 2D Engine Operations mode.
    Maintains exact 24-channel physics contract and redline bounds.
    """
    def __init__(
        self,
        seed: Optional[int] = 42,
        config: Rotax915Config = DEFAULT_CONFIG
    ):
        self.seed = seed
        self.cfg = config
        self.t_s = 0.0
        self.is_initialized = False
        
        # Submodules
        self.context_gen = OpsContextGenerator(seed=seed)
        self.sensor_model = NominalSensorModel(self.cfg)
        self.lag_bank = SensorLagBank()
        self.noise_engine = CorrelatedNoiseEngine(seed=seed)
        self.fault_mgr = FaultManager(self.cfg)

    def set_player_input(self, control_data: Dict[str, Any]):
        """Forward real-time flight commands to context generator."""
        self.context_gen.set_player_input(control_data)

    def inject_fault(self, fault: str, severity: float, onset_delay: float = 0.0):
        """Inject any of the 10 Rotax failure modes with fast immediate onset."""
        self.fault_mgr.inject_fault(
            fault_type=fault,
            severity=severity,
            current_time_s=self.t_s,
            onset_delay=onset_delay
        )
        # Accelerate ramp duration on active faults so the player sees the effect immediately
        for active in self.fault_mgr.active_faults:
            if active.fault_type == fault:
                for profile in active.profiles.values():
                    profile.ramp_duration_s = min(2.0, profile.ramp_duration_s)
                    profile.delay_s = 0.0

    def clear_faults(self):
        """Reset fault manager to healthy nominal state."""
        self.fault_mgr = FaultManager(self.cfg)
        self.is_initialized = False # Force lag filters to re-anchor to healthy baseline

    def get_state(self) -> Dict[str, Any]:
        """Return ground-truth fault status and RUL projection."""
        return self.fault_mgr.get_state(self.t_s)

    def check_redline_violations(self, sensors: Dict[str, float]) -> List[Dict[str, Any]]:
        """Identify which sensor channels have exceeded safe operating redline thresholds."""
        violations = []
        for ch, (thresh, is_lower) in self.cfg.redline_limits.items():
            if ch in sensors:
                val = sensors[ch]
                if is_lower and val <= thresh:
                    violations.append({
                        "channel": ch,
                        "value": val,
                        "limit": thresh,
                        "type": "LOW_REDLINE"
                    })
                elif not is_lower and val >= thresh:
                    violations.append({
                        "channel": ch,
                        "value": val,
                        "limit": thresh,
                        "type": "HIGH_REDLINE"
                    })
        return violations

    def step(self, dt: float = 0.05) -> Dict[str, Any]:
        """
        Advance simulation by fractional dt seconds.
        Executes full 4-layer Rotax pipeline:
        1. Context Layer (Flight dynamics + Biome)
        2. Nominal Physics Layer
        3. Thermal Lag Dynamics (Differential ODEs with dt scaling)
        4. Fault Injection Overlay
        5. Avionics Noise & ADC Quantization
        """
        # 1. Advance Context Layer
        context = self.context_gen.step(dt=dt)
        self.t_s = context["t_s"]

        # 2. Compute Nominal Steady-State Targets
        nominal_targets = self.sensor_model.compute_nominal_targets(context)

        # Initialize lag filters on first step
        if not self.is_initialized:
            self.lag_bank.initialize(nominal_targets)
            self.is_initialized = True

        # Scale lag bank dt
        self.lag_bank.thermal_network.dt = dt
        for f in self.lag_bank.non_thermal_filters.values():
            f.dt_s = dt
            f.alpha = 1.0 - np.exp(-dt / f.tau_s)

        # Apply Thermal & Hydraulic Lag Dynamics
        lagged_sensors = self.lag_bank.apply(nominal_targets, context=context)

        # 3. Apply Fault Overlay
        faulted_sensors = self.fault_mgr.apply_faults(self.t_s, lagged_sensors)

        # 4. Add Correlated Sensor Noise & Realism
        current_rpm = float(faulted_sensors.get("rpm", 5000.0))
        noise = self.noise_engine.generate(rpm=current_rpm, t_s=self.t_s)
        
        # Biome environmental effects.
        #
        # The thermal, induction and oil-pressure shifts that used to live here
        # were DOUBLE COUNTING physics the model above already produces:
        #
        #   - desert / arctic set base_oat_c to +48 / -30 (server_ops/config.py),
        #     so context["oat_c"] already carries the ambient, and
        #     NominalSensorModel already applies it — coolant via
        #     (oat_c - 15) * 0.40, oil temp via clip((oat_c - 15) * 0.20, ...).
        #     Adding a further flat +18 degC to coolant on top applied the same
        #     desert twice.
        #   - the >4800 m MAP/fuel/rpm roll-off duplicated the TCU critical-
        #     altitude model already in NominalSensorModel.
        #
        # Beyond being wrong physics, the duplicated half was INVISIBLE to the
        # nominal twin: the twin sees only (throttle, alt, oat, ias, phase), so
        # it predicts the ambient response correctly and the bolt-on offset
        # lands entirely in the residual. Against a healthy coolant sigma of
        # 0.39 degC, +18 degC of it reads as roughly 47 sigma — a healthy desert
        # sortie diagnosed as a hard cooling failure, permanently.
        #
        # Turbulence and lightning EMI are kept, because they are genuinely
        # external disturbances that no amount of context regression can predict
        # from throttle and altitude. They stay confined to the storm biome and
        # are driven by the biome's own declared vib_extra / volt_noise rather
        # than by numbers hardcoded here.
        storm_vib = float(context.get("vib_extra", 0.0))
        storm_volt_noise = float(context.get("volt_noise", 0.0))

        final_sensors: Dict[str, float] = {}
        for ch in SENSOR_CHANNELS:
            raw_val = faulted_sensors.get(ch, 0.0) + noise.get(ch, 0.0)

            if ch == "vib_rms_g" and storm_vib > 0.0:
                raw_val += abs(float(self.context_gen.rng.normal(0.0, storm_vib)))
            elif ch == "bus_voltage_v" and storm_volt_noise > 0.0:
                raw_val += float(self.context_gen.rng.normal(0.0, storm_volt_noise))
            
            # Physical non-negative floor bounds
            if "press" in ch or "flow" in ch or ch in ("rpm", "vib_rms_g", "map_kpa", "alt_current_a"):
                raw_val = max(0.0, raw_val)
                
            # ADC Quantization pass
            quantized_val = self.noise_engine.quantize(ch, raw_val)
            
            # CAN bus dropout simulation
            final_val = self.noise_engine.check_can_dropout(ch, quantized_val)
            final_sensors[ch] = round(float(final_val), 3)

        # 5. Compute Ground Truth RUL / Redline Status
        fault_state = self.fault_mgr.get_state(self.t_s)
        t_to_redline = self.fault_mgr.compute_t_to_redline(self.t_s, lagged_sensors)
        violations = self.check_redline_violations(final_sensors)

        frame: Dict[str, Any] = {
            "t_s": round(float(self.t_s), 2),
            "throttle_pct": round(float(context["throttle_pct"]), 2),
            "alt_m": round(float(context["alt_m"]), 2),
            "oat_c": round(float(context["oat_c"]), 2),
            "ias_kt": round(float(context["ias_kt"]), 2),
            "phase": str(context["phase"]),
            **final_sensors,
            "fault_label": str(fault_state["fault_label"]),
            "severity": float(fault_state["severity"]),
            "t_to_redline": float(t_to_redline) if t_to_redline is not None else None,
            # Flight context
            "pitch_norm": round(float(context.get("pitch_norm", 0.0)), 2),
            "roll_norm": round(float(context.get("roll_norm", 0.0)), 2),
            "flaps": bool(context.get("flaps", False)),
            "gear": bool(context.get("gear", False)),
            "autopilot": bool(context.get("autopilot", False)),
            "ap_target_alt": round(float(context.get("ap_target_alt", 1500.0)), 1),
            "biome_id": str(context["biome_id"]),
            "biome_name": str(context["biome_name"]),
            "redline_violations": violations,
        }

        return frame
