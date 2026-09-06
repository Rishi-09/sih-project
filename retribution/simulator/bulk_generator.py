"""
Bulk dataset generator for ML team (R2).
Generates ~200 labeled flight runs into data/runs_v2/*.parquet with randomized conditions,
single faults, sensor faults, and compound faults with ground truth t_to_redline labels for Rotax 915 iS A / iSC A.
Also copies sensors.json and outputs dataset_summary.json into the destination folder.
"""

import json
import os
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd

from .config import ALL_COLUMNS
from .context import MissionProfile
from .engine_sim import simulate_run
from .faults import FaultType

def generate_bulk_dataset(
    output_dir: str = "data/runs_v2",
    total_runs: int = 200,
    healthy_ratio: float = 0.35,
    compound_ratio: float = 0.10,
    base_seed: int = 1000,
    max_duration_s: Optional[float] = None
) -> Dict[str, Any]:
    """
    Generate bulk synthetic dataset for ML model training.
    
    Distribution:
      - ~35% Healthy runs (~70 runs) -> Pile A (Twin & Anomaly)
      - ~55% Single-fault & Sensor-fault runs (~110 runs) -> Pile B (Classifier & Sensor Consistency)
      - ~10% Compound-fault runs (~20 runs) -> Pile B (Multi-fault calibration)
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(base_seed)
    
    n_healthy = int(total_runs * healthy_ratio)
    n_compound = int(total_runs * compound_ratio)
    n_single = total_runs - n_healthy - n_compound

    single_fault_pool = [
        FaultType.LUBRICATION_DEGRADATION.value,
        FaultType.COOLING_FAILURE.value,
        FaultType.IGNITION_FAULT_CYL3.value,
        FaultType.INDUCTION_LOSS.value,
        FaultType.BEARING_WEAR.value,
        FaultType.FUEL_SYSTEM_DEGRADATION.value,
        FaultType.INJECTOR_FAULT_CYL3.value,
        FaultType.ELECTRICAL_DEGRADATION.value,
        FaultType.SENSOR_FREEZE_COOLANT.value,
        FaultType.SENSOR_DRIFT_OILPRESS.value,
    ]

    compound_fault_pairs = [
        (FaultType.BEARING_WEAR.value, FaultType.INDUCTION_LOSS.value),
        (FaultType.LUBRICATION_DEGRADATION.value, FaultType.COOLING_FAILURE.value),
        (FaultType.FUEL_SYSTEM_DEGRADATION.value, FaultType.IGNITION_FAULT_CYL3.value),
        (FaultType.LUBRICATION_DEGRADATION.value, FaultType.BEARING_WEAR.value),
        (FaultType.ELECTRICAL_DEGRADATION.value, FaultType.FUEL_SYSTEM_DEGRADATION.value),
        (FaultType.INJECTOR_FAULT_CYL3.value, FaultType.COOLING_FAILURE.value),
    ]

    manifest: List[Dict[str, Any]] = []

    print(f"--- Starting Bulk Dataset Generation ({total_runs} flights) ---")
    print(f"Destination: {out_path.resolve()}")
    print(f"Target: {n_healthy} Healthy | {n_single} Single/Sensor-Fault | {n_compound} Compound-Fault")

    for i in range(total_runs):
        run_seed = int(base_seed + i * 17)
        flight_id = f"flight_{i+1:03d}"
        file_path = out_path / f"{flight_id}.parquet"

        # Randomized mission profile
        target_alt_m = float(rng.uniform(2000.0, 5500.0))
        sea_level_oat_c = float(rng.uniform(-5.0, 43.0))
        loiter_duration_s = float(rng.uniform(600.0, 1800.0))
        
        # 10% of missions feature dynamic rapid throttle transitions (S6 style)
        rapid_bursts = bool(rng.random() < 0.10)

        profile = MissionProfile(
            target_alt_m=target_alt_m,
            loiter_duration_s=loiter_duration_s,
            sea_level_oat_c=sea_level_oat_c,
            climb_rate_mps=float(rng.uniform(3.5, 5.5)),
            descent_rate_mps=float(rng.uniform(2.5, 4.0)),
            rapid_throttle_bursts=rapid_bursts
        )

        faults: List[tuple] = []
        
        if i < n_healthy:
            category = "healthy"
            pile = "Pile A (Twin & Anomaly)"
        elif i < n_healthy + n_single:
            category = "single_fault"
            pile = "Pile B (Classifier)"
            fault_type = single_fault_pool[(i - n_healthy) % len(single_fault_pool)]
            severity = float(rng.uniform(0.35, 0.95))
            onset_time_s = float(rng.uniform(120.0, 600.0))
            faults.append((fault_type, severity, onset_time_s))
        else:
            category = "compound_fault"
            pile = "Pile B (Classifier Compound)"
            pair = compound_fault_pairs[(i - n_healthy - n_single) % len(compound_fault_pairs)]
            f1, f2 = pair
            sev1 = float(rng.uniform(0.35, 0.70))
            sev2 = float(rng.uniform(0.30, 0.65))
            onset1 = float(rng.uniform(150.0, 400.0))
            onset2 = onset1 + float(rng.uniform(60.0, 180.0))
            faults.append((f1, sev1, onset1))
            faults.append((f2, sev2, onset2))

        df = simulate_run(profile=profile, seed=run_seed, faults=faults, use_jsbsim=False, max_duration_s=max_duration_s)
        df.to_parquet(file_path, index=False)

        manifest_entry = {
            "flight_id": flight_id,
            "file_name": file_path.name,
            "category": category,
            "pile": pile,
            "rows": len(df),
            "target_alt_m": round(target_alt_m, 1),
            "sea_level_oat_c": round(sea_level_oat_c, 1),
            "rapid_bursts": rapid_bursts,
            "faults": faults
        }
        manifest.append(manifest_entry)

        if (i + 1) % 25 == 0 or (i + 1) == total_runs:
            print(f"Generated [{i+1}/{total_runs}] flights -> {flight_id}.parquet")

    summary_file = out_path / "dataset_summary.json"
    with open(summary_file, "w") as f:
        json.dump({
            "total_runs": total_runs,
            "n_healthy": n_healthy,
            "n_single_fault": n_single,
            "n_compound_fault": n_compound,
            "columns": ALL_COLUMNS,
            "manifest": manifest
        }, f, indent=2)

    # Copy sensors.json into the output runs directory for self-contained ML package
    sensors_source = Path("sensors.json")
    if sensors_source.exists():
        shutil.copy(sensors_source, out_path / "sensors.json")

    print(f"=== Bulk Dataset Generation Complete ===")
    print(f"Saved {total_runs} parquet files to: {out_path.resolve()}")
    print(f"Summary written to: {summary_file.resolve()}")
    return {"total_runs": total_runs, "output_dir": str(out_path.resolve()), "summary_file": str(summary_file)}


if __name__ == "__main__":
    generate_bulk_dataset()
