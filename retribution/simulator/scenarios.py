"""
Canned Demo Scenarios (S1–S6) with fixed seeds for reproducible stage demos.
Rotax 915 iS A / iSC A (19 engine sensors with physics-estimated CHT channels).
"""

from dataclasses import dataclass
from typing import List, Tuple, Dict, Any, Optional
import pandas as pd

from .context import MissionProfile
from .engine_sim import EngineSim, simulate_run

@dataclass
class ScenarioDefinition:
    scenario_id: str
    name: str
    seed: int
    profile: MissionProfile
    faults: List[Tuple[str, float, float]]  # (fault_type, severity, onset_time_s)
    what_it_proves: str
    expected_ehi_behavior: str


SCENARIOS: Dict[str, ScenarioDefinition] = {
    "S1": ScenarioDefinition(
        scenario_id="S1",
        name="Nominal Sortie (Baseline)",
        seed=101,
        profile=MissionProfile(target_alt_m=4000.0, loiter_duration_s=1200.0, sea_level_oat_c=22.0),
        faults=[],
        what_it_proves="Baseline healthy flight. Residuals remain flat near zero, EHI > 97, zero false alarms. Establishes that the system does not cry wolf.",
        expected_ehi_behavior="EHI stays in 97–100 range throughout entire flight."
    ),
    "S2": ScenarioDefinition(
        scenario_id="S2",
        name="Slow Lubrication Decay (Flagship)",
        seed=202,
        profile=MissionProfile(target_alt_m=4500.0, loiter_duration_s=1800.0, sea_level_oat_c=25.0),
        faults=[("lubrication_degradation", 0.65, 340.0)],
        what_it_proves="Detection lead time. Flags oil pressure drop and temperature rise 9 minutes before any gauge reaches a redline.",
        expected_ehi_behavior="EHI drops progressively from ~98 down to <60 around T+500s; lubrication subsystem flags early."
    ),
    "S3": ScenarioDefinition(
        scenario_id="S3",
        name="Cylinder 3 Ignition Fault",
        seed=303,
        profile=MissionProfile(target_alt_m=3500.0, loiter_duration_s=1200.0, sea_level_oat_c=18.0),
        faults=[("ignition_fault_cyl3", 0.85, 400.0)],
        what_it_proves="Per-cylinder spatial resolution. The UI/schematic lights up only Cylinder 3 (EGT_3 drops, CHT_3 cools), proving the model isolates the exact faulty cylinder.",
        expected_ehi_behavior="Combustion and cooling subsystems flag localized Cyl 3 divergence instantly at T+400s."
    ),
    "S4": ScenarioDefinition(
        scenario_id="S4",
        name="Hot-Day Climb (Twin vs Static Thresholds)",
        seed=404,
        profile=MissionProfile(target_alt_m=5000.0, loiter_duration_s=1200.0, sea_level_oat_c=41.0),
        faults=[],
        what_it_proves="The winning demo beat. CHT reaches ~128°C under desert heat. A static threshold system triggers a false alarm. The digital twin expects 126°C given 41°C OAT, so residual is ~0 and EHI stays healthy (>95).",
        expected_ehi_behavior="EHI remains healthy (>95) despite high raw sensor temperatures."
    ),
    "S5": ScenarioDefinition(
        scenario_id="S5",
        name="Compound Fault (Bearing Wear + Induction Loss)",
        seed=505,
        profile=MissionProfile(target_alt_m=4500.0, loiter_duration_s=1800.0, sea_level_oat_c=24.0),
        faults=[
            ("bearing_wear", 0.50, 300.0),
            ("induction_loss", 0.40, 450.0)
        ],
        what_it_proves="Multi-fault additive composition and honest uncertainty. Both faults affect RPM and vibration. The classifier splits confidence across both classes rather than forcing a false single choice.",
        expected_ehi_behavior="Mechanical subsystem degrades first at T+300s, followed by induction_fuel degradation at T+450s."
    ),
    "S6": ScenarioDefinition(
        scenario_id="S6",
        name="Rapid Throttle Transitions (Dynamic Transients)",
        seed=606,
        profile=MissionProfile(
            target_alt_m=4000.0,
            loiter_duration_s=1200.0,
            sea_level_oat_c=20.0,
            rapid_throttle_bursts=True
        ),
        faults=[],
        what_it_proves="Direct PS requirement. Proves the twin's transient response is correct during fast power step changes (e.g. target reacquisition burst to 100% then idle). A naive threshold system false-alarms on temperature/pressure spikes; the digital twin follows the dynamic lag and stays healthy.",
        expected_ehi_behavior="EHI remains in 96–100 range despite sharp throttle transitions."
    )
}


def get_canned_scenario(scenario_id: str) -> EngineSim:
    """Instantiate an EngineSim configured with a canned scenario definition."""
    scen_key = scenario_id.upper()
    if scen_key not in SCENARIOS:
        raise ValueError(f"Unknown scenario ID: {scenario_id}. Available: {list(SCENARIOS.keys())}")
    
    defn = SCENARIOS[scen_key]
    sim = EngineSim(profile=defn.profile, seed=defn.seed)
    for fault_type, severity, onset_time in defn.faults:
        sim.inject_fault(fault_type, severity, onset_delay=onset_time)
    return sim


def list_scenarios() -> List[Dict[str, Any]]:
    """List all available canned scenario summaries."""
    return [
        {
            "id": s.scenario_id,
            "name": s.name,
            "seed": s.seed,
            "faults": s.faults,
            "proves": s.what_it_proves
        }
        for s in SCENARIOS.values()
    ]
