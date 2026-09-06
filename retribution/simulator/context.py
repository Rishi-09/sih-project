"""
Flight context generators for MALE UAV missions.
Provides the 5 context channels: throttle_pct, alt_m, oat_c, ias_kt, phase.
"""

from dataclasses import dataclass
from typing import Generator, Dict, Any, List, Optional
import numpy as np

@dataclass
class MissionProfile:
    """Defines a MALE UAV mission trajectory parameters."""
    target_alt_m: float = 4500.0        # Target cruise/loiter altitude (meters)
    loiter_duration_s: float = 1200.0   # Loiter duration in seconds (e.g. 20 min)
    sea_level_oat_c: float = 20.0       # Ambient temperature at sea level (°C)
    cruise_ias_kt: float = 90.0         # Cruise indicated airspeed (knots)
    takeoff_ias_kt: float = 65.0        # Takeoff speed (knots)
    climb_rate_mps: float = 4.5         # Climb rate (m/s)
    descent_rate_mps: float = 3.0       # Descent rate (m/s)
    rapid_throttle_bursts: bool = False # Flag for S6 rapid power transitions


class KinematicContextGenerator:
    """
    High-speed, physically grounded flight kinematics generator for MALE UAVs.
    Implements standard ISA atmosphere lapse rate, power curves, and flight state transitions.
    """
    def __init__(self, profile: MissionProfile, seed: Optional[int] = None):
        self.profile = profile
        self.rng = np.random.default_rng(seed)
        self.dt = 1.0  # 1 second step
        
        # Internal state
        self.t_s = 0.0
        self.phase = "STARTUP"
        self.alt_m = 0.0
        self.ias_kt = 0.0
        self.throttle_pct = 0.0
        
        # Phase durations (in seconds)
        self.startup_duration = 30.0
        self.taxi_duration = 60.0
        self.takeoff_duration = 40.0
        self.climb_duration = (self.profile.target_alt_m / max(0.5, self.profile.climb_rate_mps))
        self.cruise_duration = 180.0
        self.loiter_duration = self.profile.loiter_duration_s
        self.descent_duration = (self.profile.target_alt_m / max(0.5, self.profile.descent_rate_mps))
        self.approach_duration = 60.0
        self.shutdown_duration = 30.0
        
        # Phase transition timeline
        self.t_taxi = self.startup_duration
        self.t_takeoff = self.t_taxi + self.taxi_duration
        self.t_climb = self.t_takeoff + self.takeoff_duration
        self.t_cruise = self.t_climb + self.climb_duration
        self.t_loiter = self.t_cruise + self.cruise_duration
        self.t_descent = self.t_loiter + self.loiter_duration
        self.t_approach = self.t_descent + self.descent_duration
        self.t_shutdown = self.t_approach + self.approach_duration
        self.total_mission_time = self.t_shutdown + self.shutdown_duration

    def _compute_oat(self, alt_m: float) -> float:
        """Standard ISA atmospheric temperature lapse rate (-6.5 °C / 1000m)."""
        return self.profile.sea_level_oat_c - (0.0065 * alt_m)

    def step(self) -> Dict[str, Any]:
        """Advance flight context by 1 second and return context dictionary."""
        t = self.t_s
        
        # State machine for phase & targets
        if t < self.t_taxi:
            self.phase = "STARTUP"
            self.alt_m = 0.0
            self.ias_kt = 0.0
            self.throttle_pct = 15.0
            
        elif t < self.t_takeoff:
            self.phase = "TAXI"
            self.alt_m = 0.0
            progress = (t - self.t_taxi) / self.taxi_duration
            self.ias_kt = 10.0 + 5.0 * np.sin(progress * np.pi)
            self.throttle_pct = 30.0
            
        elif t < self.t_climb:
            self.phase = "TAKEOFF"
            progress = (t - self.t_takeoff) / self.takeoff_duration
            self.alt_m = progress * 100.0
            self.ias_kt = 15.0 + progress * (self.profile.takeoff_ias_kt - 15.0)
            self.throttle_pct = 100.0
            
        elif t < self.t_cruise:
            self.phase = "CLIMB"
            progress = (t - self.t_climb) / max(1.0, self.climb_duration)
            self.alt_m = 100.0 + progress * (self.profile.target_alt_m - 100.0)
            self.ias_kt = self.profile.takeoff_ias_kt + progress * (self.profile.cruise_ias_kt - self.profile.takeoff_ias_kt)
            self.throttle_pct = 90.0
            
        elif t < self.t_loiter:
            self.phase = "CRUISE"
            self.alt_m = self.profile.target_alt_m + 5.0 * np.sin(t * 0.05)
            self.ias_kt = self.profile.cruise_ias_kt + 1.0 * np.sin(t * 0.03)
            
            # S6: Rapid throttle transitions check
            if self.profile.rapid_throttle_bursts:
                # Periodic sharp bursts: 100% burst, then snap down to 35%, then back to 70%
                cycle_t = t % 90.0
                if cycle_t < 15.0:
                    self.throttle_pct = 100.0  # Full power step burst
                elif cycle_t < 25.0:
                    self.throttle_pct = 30.0   # Fast power reduction
                else:
                    self.throttle_pct = 70.0   # Nominal cruise
            else:
                self.throttle_pct = 70.0
            
        elif t < self.t_descent:
            self.phase = "LOITER"
            self.alt_m = self.profile.target_alt_m + 10.0 * np.sin(t * 0.02)
            self.ias_kt = self.profile.cruise_ias_kt - 5.0 + 1.5 * np.cos(t * 0.02)
            
            if self.profile.rapid_throttle_bursts:
                cycle_t = t % 90.0
                if cycle_t < 15.0:
                    self.throttle_pct = 95.0
                elif cycle_t < 25.0:
                    self.throttle_pct = 35.0
                else:
                    self.throttle_pct = 65.0
            else:
                self.throttle_pct = 65.0
            
        elif t < self.t_approach:
            self.phase = "DESCENT"
            progress = (t - self.t_descent) / max(1.0, self.descent_duration)
            self.alt_m = max(50.0, self.profile.target_alt_m * (1.0 - progress))
            self.ias_kt = self.profile.cruise_ias_kt - 10.0
            self.throttle_pct = 35.0
            
        elif t < self.t_shutdown:
            self.phase = "APPROACH"
            progress = (t - self.t_approach) / self.approach_duration
            self.alt_m = max(0.0, 50.0 * (1.0 - progress))
            self.ias_kt = max(0.0, 55.0 * (1.0 - progress))
            self.throttle_pct = 25.0
            
        else:
            self.phase = "SHUTDOWN"
            self.alt_m = 0.0
            self.ias_kt = 0.0
            self.throttle_pct = 0.0

        oat_c = self._compute_oat(self.alt_m)
        
        record = {
            "t_s": float(self.t_s),
            "throttle_pct": float(np.clip(self.throttle_pct, 0.0, 100.0)),
            "alt_m": float(max(0.0, self.alt_m)),
            "oat_c": float(oat_c),
            "ias_kt": float(max(0.0, self.ias_kt)),
            "phase": str(self.phase),
        }
        
        self.t_s += self.dt
        return record

    def is_finished(self) -> bool:
        return self.t_s >= self.total_mission_time


class JSBSimContextGenerator:
    """JSBSim Flight Dynamics wrapper that runs JSBSim flight kinematics."""
    def __init__(self, profile: MissionProfile, seed: Optional[int] = None):
        self.profile = profile
        self.seed = seed or 42
        self.kinematic_fallback = KinematicContextGenerator(profile, seed=self.seed)
        self.has_jsbsim = False
        self._init_jsbsim()

    def _init_jsbsim(self):
        try:
            import jsbsim
            from pathlib import Path
            
            self.fdm = jsbsim.FGFDMExec(None)
            self.fdm.set_debug_level(0)
            
            aircraft_path = Path("aircraft")
            if (aircraft_path / "c172p" / "c172p.xml").exists():
                self.fdm.set_aircraft_path(str(aircraft_path.resolve()))
                self.fdm.load_model("c172p")
            else:
                self.fdm.load_model("c172p")
                
            self.fdm['ic/h-sl-ft'] = 1000.0
            self.fdm['ic/vc-kts'] = 75.0
            self.fdm['ic/gamma-deg'] = 0.0
            self.fdm['propulsion/set-running'] = -1
            self.fdm.run_ic()
            
            self.dt = self.fdm.get_delta_t()
            self.t_s = 0.0
            self.next_log_time = 0.0
            self.has_jsbsim = True
        except Exception:
            self.has_jsbsim = False

    def step(self) -> Dict[str, Any]:
        if not self.has_jsbsim:
            return self.kinematic_fallback.step()
            
        try:
            target_time = self.t_s + 1.0
            while self.fdm.get_sim_time() < target_time:
                self.fdm.run()
                
            self.t_s = target_time
            cur_alt_m = self.fdm['position/h-sl-ft'] * 0.3048
            cur_ias_kt = self.fdm['velocities/vc-kts']
            throttle = self.fdm['fcs/throttle-cmd-norm'] * 100.0
            oat_c = (self.fdm['atmosphere/T-R'] * (5.0 / 9.0)) - 273.15
            
            phase = "CRUISE"
            if self.t_s < 60:
                phase = "TAKEOFF"
            elif cur_alt_m < self.profile.target_alt_m - 200:
                phase = "CLIMB"
                
            return {
                "t_s": float(self.t_s),
                "throttle_pct": float(np.clip(throttle, 0.0, 100.0)),
                "alt_m": float(max(0.0, cur_alt_m)),
                "oat_c": float(oat_c),
                "ias_kt": float(max(0.0, cur_ias_kt)),
                "phase": str(phase),
            }
        except Exception:
            return self.kinematic_fallback.step()

    def is_finished(self) -> bool:
        return self.kinematic_fallback.is_finished()
