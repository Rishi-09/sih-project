"""
OpsContextGenerator: Flight dynamics context generator for 2D Engine Operations Game.
Translates real-time player pitch, throttle, and biome inputs into the 5 standard context channels:
(throttle_pct, alt_m, oat_c, ias_kt, phase).
"""

from typing import Dict, Any, Optional
import numpy as np
from .config import BIOMES, SERVICE_CEILING_M


class OpsContextGenerator:
    """
    Flight dynamics context generator for 2D/2.5D operations mode.
    Altitude is continuously integrated via pitch dynamics (or autopilot), not arbitrarily overwritten.
    """
    def __init__(self, seed: Optional[int] = 42):
        self.rng = np.random.default_rng(seed)
        
        # Flight state variables (Defaults to Ground Runway at 0m altitude)
        self.t_s = 0.0
        self.alt_m = 0.0          # Ground altitude: 0 meters
        self.ias_kt = 0.0         # Airspeed: 0 knots on ground
        self.throttle_pct = 0.0   # Engine Idle: 0%
        self.pitch_norm = 0.0     # Level
        self.roll_norm = 0.0      # Level
        self.flaps = False
        self.gear = True          # Wheels down on ground
        self.autopilot = False
        self.ap_target_alt = 1500.0 # meters
        self.phase = "STARTUP"
        
        # Selected biome
        self.current_biome_id = "normal"
        self.current_biome_name = BIOMES["normal"]["name"]

        # Atmospheric disturbance state — see _step_flight_dynamics.
        self._gust_alt = 0.0
        self._gust_ias = 0.0

    def set_player_input(self, control_data: Dict[str, Any]):
        """
        Receive sanitized control packet from InputManager / WebSocket.
        """
        if "throttle" in control_data and control_data["throttle"] is not None:
            self.throttle_pct = float(np.clip(control_data["throttle"], 0.0, 100.0))
            
        if "pitch" in control_data and control_data["pitch"] is not None:
            self.pitch_norm = float(np.clip(control_data["pitch"], -1.0, 1.0))
            
        if "roll" in control_data and control_data["roll"] is not None:
            self.roll_norm = float(np.clip(control_data["roll"], -1.0, 1.0))
            
        if "biome" in control_data and control_data["biome"] in BIOMES:
            self.current_biome_id = str(control_data["biome"])
            self.current_biome_name = BIOMES[self.current_biome_id]["name"]
            
        if "flaps" in control_data and control_data["flaps"] is not None:
            self.flaps = bool(control_data["flaps"])
            
        if "gear" in control_data and control_data["gear"] is not None:
            self.gear = bool(control_data["gear"])
            
        if "autopilot" in control_data and control_data["autopilot"] is not None:
            self.autopilot = bool(control_data["autopilot"])
            
        if "ap_target_alt" in control_data and control_data["ap_target_alt"] is not None:
            self.ap_target_alt = float(np.clip(control_data["ap_target_alt"], 0.0, SERVICE_CEILING_M))

    def _compute_oat(self, biome_data: Dict[str, Any]) -> float:
        """
        ISA Standard atmospheric lapse rate (-6.5°C per 1000m)
        anchored at the active biome's base temperature.
        """
        base_temp = biome_data["base_oat_c"]
        lapse_oat = base_temp - (0.0065 * self.alt_m)
        return float(lapse_oat)

    def _step_flight_dynamics(self, dt: float):
        """
        Step pitch/climb/airspeed flight dynamics by fractional delta time dt.
        """
        # 1. Airspeed dynamics (Rotax 915 iS cruise ~115 kt at 100% throttle, drag increases with flaps/gear)
        drag_factor = 1.0 + (0.18 if self.gear else 0.0) + (0.25 if self.flaps else 0.0)
        target_ias = ((self.throttle_pct / 100.0) * 135.0) / drag_factor
        
        effective_pitch = self.pitch_norm
        if self.autopilot:
            # Autopilot PID controller smoothly locking ap_target_alt
            alt_error = self.ap_target_alt - self.alt_m
            effective_pitch = float(np.clip(alt_error / 150.0, -0.7, 0.7))
            
        target_ias -= effective_pitch * 15.0
        target_ias = max(0.0, target_ias)
        
        # Fast responsive airspeed update
        alpha_ias = 1.0 - np.exp(-dt / 1.2)
        self.ias_kt += alpha_ias * (target_ias - self.ias_kt)
        
        # 2. Vertical climb rate based on pitch input (direct, arcade-responsive authority)
        # Pitch = +1.0 -> ~+22 m/s climb; Pitch = -1.0 -> ~-22 m/s dive
        v_factor = max(0.3, self.ias_kt / 70.0)
        climb_rate = effective_pitch * 24.0 * v_factor
        
        # Low throttle stall penalty if attempting steep climb with no engine power
        if effective_pitch > 0.2 and self.throttle_pct < 20.0:
            climb_rate *= (self.throttle_pct / 20.0)
            
        self.alt_m = float(np.clip(self.alt_m + climb_rate * dt, 0.0, SERVICE_CEILING_M))

        # 2b. Atmospheric disturbance.
        #
        # Without this the autopilot holds altitude and airspeed PERFECTLY, and
        # a cruise leg becomes numerically frozen: every context input is
        # constant, so the nominal twin returns a constant prediction, the
        # sensor sits on one ADC step, and the residual is literally invariant.
        # The window features then come out degenerate — window_std_z and
        # window_slope_z of exactly 0.0 on the CHT channels — which is a
        # combination that appears nowhere in training, where CRUISE carried
        # alt +/- 5 m and ias +/- 1 kt of deliberate perturbation
        # (simulator/context.py). Fed those, the 91-class classifier returned
        # 100% confidence in injector_fault_cyl3+sensor_freeze_coolant on a
        # completely healthy engine.
        #
        # Real air is never still, and the fix is to stop pretending it is: a
        # slow random walk, mean-reverting so it wanders without drifting away,
        # at roughly the amplitude the training generator used. Airborne only —
        # an aircraft on the runway is not being bounced around by gusts.
        if self.alt_m > 2.0:
            tau = 12.0
            decay = float(np.exp(-dt / tau))
            # AR(1) innovation scaled by sqrt(1 - decay^2) so the process has
            # the intended STATIONARY amplitude regardless of dt — the same
            # parameterisation simulator/thermal.py uses for its pink noise.
            # Scaling by (1 - decay) instead makes the amplitude collapse as dt
            # shrinks, which at the ops sim's 0.05 s step left gusts of 0.1 m.
            innov = float(np.sqrt(max(0.0, 1.0 - decay * decay)))
            self._gust_alt = self._gust_alt * decay + float(self.rng.normal(0.0, 2.2)) * innov
            self._gust_ias = self._gust_ias * decay + float(self.rng.normal(0.0, 0.9)) * innov
        else:
            self._gust_alt = 0.0
            self._gust_ias = 0.0
        
        # 3. Flight Phase derivation
        if self.alt_m < 2.0:
            if self.ias_kt < 5.0:
                self.phase = "STARTUP"
            elif self.ias_kt < 35.0:
                self.phase = "TAXI"
            else:
                self.phase = "TAKEOFF"
        else:
            if climb_rate > 0.8:
                self.phase = "CLIMB"
            elif climb_rate < -0.8:
                self.phase = "DESCENT"
            else:
                self.phase = "CRUISE"

    def step(self, dt: float = 0.05) -> Dict[str, Any]:
        """
        Advance flight context by dt seconds and produce 5-channel dictionary + environment flags.
        """
        self._step_flight_dynamics(dt)
        biome = BIOMES.get(self.current_biome_id, BIOMES["normal"])
        oat_c = self._compute_oat(biome)
        
        context_record = {
            "t_s": float(self.t_s),
            "throttle_pct": float(np.clip(self.throttle_pct, 0.0, 100.0)),
            # Gusts ride on the reported altitude/airspeed, exactly as they
            # would on a real air-data probe.
            "alt_m": float(max(0.0, self.alt_m + self._gust_alt)),
            "oat_c": float(oat_c),
            "ias_kt": float(max(0.0, self.ias_kt + self._gust_ias)),
            "phase": str(self.phase),
            # Metadata for 2D UI
            "pitch_norm": float(self.pitch_norm),
            "roll_norm": float(self.roll_norm),
            "flaps": bool(self.flaps),
            "gear": bool(self.gear),
            "autopilot": bool(self.autopilot),
            "ap_target_alt": float(self.ap_target_alt),
            "biome_id": str(self.current_biome_id),
            "biome_name": str(self.current_biome_name),
            "vib_extra": float(biome.get("vib_extra", 0.0)),
            "volt_noise": float(biome.get("volt_noise", 0.0)),
        }
        
        self.t_s += dt
        return context_record
