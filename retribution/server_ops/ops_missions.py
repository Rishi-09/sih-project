"""
OpsMissions: 10 Escalating Missions, Dynamic Fault Injections, Scoring and Progression.
"""

from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger("OpsMissions")

MISSIONS = [
    {
        "id": 1,
        "name": "Clean Startup & Cruise",
        "description": "Perform clean engine startup, climb to 1,500m, and stabilize cruise RPM at 5,000-5,500 RPM for 30s.",
        "biome": "normal",
        "duration_s": 90.0,
        "target_alt_min": 1200.0,
        "target_alt_max": 1800.0,
        "target_rpm_min": 4800.0,
        "target_rpm_max": 5600.0,
        "auto_faults": [],
        "scoring_weight": 1.0,
    },
    {
        "id": 2,
        "name": "Desert Thermal Patrol",
        "description": "Operate in Thar Desert (+48°C ambient). Manage throttle to keep coolant < 112°C and oil < 120°C.",
        "biome": "desert",
        "duration_s": 100.0,
        "target_alt_min": 800.0,
        "target_alt_max": 2500.0,
        "max_coolant_temp": 112.0,
        "max_oil_temp": 120.0,
        "auto_faults": [],
        "scoring_weight": 1.2,
    },
    {
        "id": 3,
        "name": "Himalayan Arctic Cold Start",
        "description": "Sub-zero cold start (-30°C). Warm oil above 70°C before exceeding 4,500 RPM without oil overpressure.",
        "biome": "arctic",
        "duration_s": 100.0,
        "target_oil_warm": 70.0,
        "auto_faults": [],
        "scoring_weight": 1.3,
    },
    {
        "id": 4,
        "name": "Monsoon Storm Penetration",
        "description": "Navigate heavy storm turbulence and EMI. Maintain altitude at 2,500m while monitoring vibration and bus voltage.",
        "biome": "storm",
        "duration_s": 90.0,
        "target_alt_min": 2200.0,
        "target_alt_max": 2800.0,
        "auto_faults": [],
        "scoring_weight": 1.4,
    },
    {
        "id": 5,
        "name": "Oil Pressure Crisis",
        "description": "Lubrication failure will occur at t=15s. Diagnose oil pressure loss, throttle back to 35%, and descend safely.",
        "biome": "normal",
        "duration_s": 100.0,
        "auto_faults": [
            {"time_s": 15.0, "fault": "lubrication_degradation", "severity": 0.65}
        ],
        "scoring_weight": 1.5,
    },
    {
        "id": 6,
        "name": "Desert Cooling Emergency",
        "description": "Cooling pump failure at t=15s in +48°C desert heat. Prevent thermal runaway redline by reducing power.",
        "biome": "desert",
        "duration_s": 100.0,
        "auto_faults": [
            {"time_s": 15.0, "fault": "cooling_failure", "severity": 0.70}
        ],
        "scoring_weight": 1.6,
    },
    {
        "id": 7,
        "name": "Stratospheric Ceiling Push",
        "description": "Climb above TCU critical altitude (4,800m) to 5,500m. Induction loss occurs at t=25s. Compensate power droop.",
        "biome": "high_alt",
        "duration_s": 110.0,
        "target_alt_min": 5000.0,
        "auto_faults": [
            {"time_s": 25.0, "fault": "induction_loss", "severity": 0.45}
        ],
        "scoring_weight": 1.7,
    },
    {
        "id": 8,
        "name": "Electrical Alternator Failure",
        "description": "Alternator failure in monsoon storm at t=15s. Manage battery drain and bus voltage drop while maintaining flight.",
        "biome": "storm",
        "duration_s": 90.0,
        "auto_faults": [
            {"time_s": 15.0, "fault": "electrical_degradation", "severity": 0.80}
        ],
        "scoring_weight": 1.8,
    },
    {
        "id": 9,
        "name": "Desert Dual Fault Cascade",
        "description": "Bearing wear at t=10s followed by cooling leak at t=25s in extreme heat. Survive the cascade without engine seizure.",
        "biome": "desert",
        "duration_s": 120.0,
        "auto_faults": [
            {"time_s": 10.0, "fault": "bearing_wear", "severity": 0.50},
            {"time_s": 25.0, "fault": "cooling_failure", "severity": 0.50}
        ],
        "scoring_weight": 2.0,
    },
    {
        "id": 10,
        "name": "Triple Threat Survival",
        "description": "Ultimate endurance in storm: Cylinder 3 ignition fault (t=10s), fuel pressure loss (t=20s), and bearing wear (t=35s).",
        "biome": "storm",
        "duration_s": 120.0,
        "auto_faults": [
            {"time_s": 10.0, "fault": "ignition_fault_cyl3", "severity": 0.75},
            {"time_s": 20.0, "fault": "fuel_system_degradation", "severity": 0.60},
            {"time_s": 35.0, "fault": "bearing_wear", "severity": 0.50}
        ],
        "scoring_weight": 2.5,
    }
]


class MissionManager:
    """
    Manages active mission progression, auto-fault triggers, score calculations, and grading.
    """
    def __init__(self, engine_sim: Any):
        self.engine = engine_sim
        self.active_mission_id: Optional[int] = None
        self.mission_data: Optional[Dict[str, Any]] = None
        
        # Mission state
        self.elapsed_s: float = 0.0
        self.is_active: bool = False
        self.is_completed: bool = False
        self.is_failed: bool = False
        self.fail_reason: str = ""
        self.triggered_fault_indices: set = set()
        
        # Score state
        self.score: float = 1000.0
        self.health_score: float = 100.0
        self.grade: str = "A"
        self.pending_events: List[Dict[str, Any]] = []

    def start_mission(self, mission_id: int):
        """Start a designated mission by ID (1-10)."""
        matching = next((m for m in MISSIONS if m["id"] == mission_id), None)
        if not matching:
            logger.warning(f"Invalid mission ID: {mission_id}")
            return
            
        self.active_mission_id = mission_id
        self.mission_data = matching
        self.elapsed_s = 0.0
        self.is_active = True
        self.is_completed = False
        self.is_failed = False
        self.fail_reason = ""
        self.triggered_fault_indices = set()
        self.score = 1000.0
        self.health_score = 100.0
        self.grade = "S"
        
        # Configure engine biome
        self.engine.clear_faults()
        self.engine.set_player_input({"biome": matching["biome"]})
        
        self.pending_events.append({
            "type": "mission_start",
            "mission_id": mission_id,
            "name": matching["name"],
            "description": matching["description"],
            "duration_s": matching["duration_s"],
            "biome": matching["biome"],
        })
        logger.info(f"Started mission {mission_id}: {matching['name']}")

    def abort_mission(self):
        """Cancel active mission."""
        self.is_active = False
        self.active_mission_id = None
        self.mission_data = None
        self.pending_events.append({"type": "mission_aborted"})

    def step(self, dt: float, telemetry: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Advance mission state by dt and evaluate objectives/penalties.
        """
        if not self.is_active or not self.mission_data or self.is_completed or self.is_failed:
            events = list(self.pending_events)
            self.pending_events.clear()
            return events

        self.elapsed_s += dt
        m = self.mission_data
        
        # 1. Check auto-fault injections
        for idx, f_spec in enumerate(m.get("auto_faults", [])):
            if idx not in self.triggered_fault_indices and self.elapsed_s >= f_spec["time_s"]:
                self.triggered_fault_indices.add(idx)
                self.engine.inject_fault(f_spec["fault"], f_spec["severity"], onset_delay=0.0)
                self.pending_events.append({
                    "type": "mission_fault_triggered",
                    "fault": f_spec["fault"],
                    "severity": f_spec["severity"],
                    "message": f"CRITICAL: {f_spec['fault'].replace('_', ' ').upper()} DETECTED!"
                })

        # 2. Score calculation & Health degradation
        violations = telemetry.get("redline_violations", [])
        if violations:
            # Major penalty for redline violation
            penalty = len(violations) * 15.0 * dt
            self.score = max(0.0, self.score - penalty)
            self.health_score = max(0.0, self.health_score - (10.0 * dt))
        else:
            # Positive survival points
            self.score += 5.0 * dt * m.get("scoring_weight", 1.0)
            self.health_score = min(100.0, self.health_score + (1.0 * dt))

        # Check mission-specific constraints
        if "max_coolant_temp" in m and telemetry.get("coolant_temp_c", 0.0) > m["max_coolant_temp"]:
            self.score = max(0.0, self.score - 20.0 * dt)
            
        if "max_oil_temp" in m and telemetry.get("oil_temp_c", 0.0) > m["max_oil_temp"]:
            self.score = max(0.0, self.score - 20.0 * dt)

        # Health total failure condition
        if self.health_score <= 0.0:
            self.is_failed = True
            self.fail_reason = "ENGINE CATASTROPHIC FAILURE — HEALTH DEPLETED"
            self.grade = "F"
            self.pending_events.append({
                "type": "mission_failed",
                "reason": self.fail_reason,
                "score": round(self.score, 0),
                "grade": self.grade
            })
            return list(self.pending_events)

        # 3. Check mission completion
        if self.elapsed_s >= m["duration_s"]:
            self.is_completed = True
            self.is_active = False
            
            # Grade assignment
            final_ratio = self.score / 1000.0
            if final_ratio >= 1.5:
                self.grade = "S"
            elif final_ratio >= 1.2:
                self.grade = "A"
            elif final_ratio >= 0.9:
                self.grade = "B"
            elif final_ratio >= 0.6:
                self.grade = "C"
            else:
                self.grade = "D"
                
            self.pending_events.append({
                "type": "mission_completed",
                "mission_id": self.active_mission_id,
                "score": round(self.score, 0),
                "grade": self.grade,
                "message": f"MISSION COMPLETE! Grade: {self.grade}"
            })

        events = list(self.pending_events)
        self.pending_events.clear()
        return events

    def get_state(self) -> Dict[str, Any]:
        """Return current mission status for client sync."""
        return {
            "active_mission_id": self.active_mission_id,
            "is_active": self.is_active,
            "is_completed": self.is_completed,
            "is_failed": self.is_failed,
            "elapsed_s": round(self.elapsed_s, 1),
            "total_duration_s": self.mission_data["duration_s"] if self.mission_data else 0.0,
            "score": round(self.score, 0),
            "health_score": round(self.health_score, 1),
            "grade": self.grade,
            "fail_reason": self.fail_reason,
        }
