"""
Rule-Based Health Index Module for R2 ML.

Step 12: Rule-Based Health Index Computation.
- Converts 60-second rolling window residual z-score features into transparent,
  deterministic 0-100 health scores for 19 engine sensors, 8 subsystems, and overall engine.
- Strictly rule-based (NOT ML-based) and fully explainable.
- Score monotonically decreases as abnormal residual/z-score magnitude increases.
- Bounded strictly between [0.0, 100.0].
- Generates dynamic, data-driven textual explanations citing observed z-score magnitudes.

Subsystems:
1. Lubrication: oil_press_bar, oil_temp_c
2. Cooling: coolant_temp_c, cht_1, cht_2, cht_3, cht_4
3. Combustion: egt_1, egt_2, egt_3, egt_4
4. Fuel: fuel_press_bar, fuel_flow_lph
5. Mechanical: rpm, vib_rms_g
6. Induction: map_kpa
7. Electrical: bus_voltage_v, alt_current_a
8. Injection: inj_timing_deg
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd

from src.preprocessing.schema import SENSOR_COLS, CONTEXT_COLS, METADATA_COLS

# 8 Subsystem definitions mapped to project's 19 engine sensors
SUBSYSTEM_MAP: Dict[str, List[str]] = {
    "lubrication": ["oil_press_bar", "oil_temp_c"],
    "cooling": ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
    "combustion": ["egt_1", "egt_2", "egt_3", "egt_4"],
    "fuel": ["fuel_press_bar", "fuel_flow_lph"],
    "mechanical": ["rpm", "vib_rms_g"],
    "induction": ["map_kpa"],
    "electrical": ["bus_voltage_v", "alt_current_a"],
    "injection": ["inj_timing_deg"],
}

SUBSYSTEM_NAMES: List[str] = list(SUBSYSTEM_MAP.keys())


def compute_sensor_health_score(
    mean_z: Union[float, np.ndarray],
    max_abs_z: Union[float, np.ndarray],
    std_z: Optional[Union[float, np.ndarray]] = None,
    slope_z: Optional[Union[float, np.ndarray]] = None,
) -> Union[float, np.ndarray]:
    """
    Compute rule-based 0-100 health score for an individual sensor from windowed z-scores.

    Formulation:
    1. Base anomaly penalty:
       effective_z = 0.55 * |mean_z| + 0.35 * max_abs_z + 0.10 * std_z + 5.0 * |slope_z|
    2. Threshold & continuous decay:
       Normal noise tolerance = 1.0 sigma.
       excess_penalty = max(0, effective_z - 1.0)
       health = 100.0 * exp(-excess_penalty / 3.0)
    3. Bounded strictly to [0.0, 100.0].

    Properties:
    - Zero/nominal deviation (effective_z <= 1.0) -> 100.0 health.
    - Increasing deviation monotonically decreases health towards 0.
    - Robust against single transient spikes while punishing sustained large departures.
    """
    m_z = np.abs(np.asarray(mean_z, dtype=np.float64))
    max_z = np.abs(np.asarray(max_abs_z, dtype=np.float64))

    s_z = np.asarray(std_z, dtype=np.float64) if std_z is not None else np.ones_like(m_z)
    sl_z = np.abs(np.asarray(slope_z, dtype=np.float64)) if slope_z is not None else np.zeros_like(m_z)

    # Incomplete windows with NaNs remain NaN
    mask_valid = np.isfinite(m_z) & np.isfinite(max_z)

    penalty = 0.55 * m_z + 0.35 * max_z + 0.10 * s_z + 5.0 * sl_z
    excess = np.maximum(0.0, penalty - 1.0)
    health = 100.0 * np.exp(-excess / 3.0)

    # Strictly clamp between 0 and 100
    health = np.clip(health, 0.0, 100.0)

    # Where inputs were NaN, retain NaN
    if isinstance(health, np.ndarray):
        health[~mask_valid] = np.nan
        return health
    return float(health) if mask_valid else np.nan


def compute_subsystem_health_scores(
    sensor_health_dict: Dict[str, np.ndarray],
    subsystem_map: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, np.ndarray]:
    """
    Compute 0-100 subsystem health scores by aggregating constituent sensor health scores.

    Aggregation rule:
        subsystem_health = 0.60 * min(sensor_health) + 0.40 * mean(sensor_health)

    Why this rule?
    - Minimum (60% weight) ensures that a catastrophic failure in any single sensor
      (e.g., severe drop in oil pressure) decisively lowers the subsystem health.
    - Mean (40% weight) reflects multi-sensor degradation when multiple channels are distressed.
    - Single-sensor subsystems evaluate exactly to min = mean = sensor_health.

    Args:
        sensor_health_dict: Dictionary mapping sensor_name -> array of health scores.
        subsystem_map: Optional mapping of subsystem -> list of sensors.

    Returns:
        Dict[str, np.ndarray]: Dictionary mapping subsystem_name -> array of health scores.
    """
    subsystems = subsystem_map or SUBSYSTEM_MAP
    subsystem_health: Dict[str, np.ndarray] = {}

    for sub_name, sensor_list in subsystems.items():
        # Stack constituent sensor health scores (shape: [n_sensors_in_sub, n_samples])
        sensor_arrays = [sensor_health_dict[s] for s in sensor_list if s in sensor_health_dict]
        if not sensor_arrays:
            raise KeyError(f"No sensor data found for subsystem '{sub_name}'.")

        stacked = np.array(sensor_arrays, dtype=np.float64)  # shape: (k, N)

        # Vectorized min and mean along sensor axis (axis=0)
        # Handle NaN values cleanly without RuntimeWarning:
        all_nan_cols = np.all(np.isnan(stacked), axis=0)
        
        # Initialize output with NaNs
        sub_score = np.full(stacked.shape[1], np.nan, dtype=np.float64)
        
        valid_cols = ~all_nan_cols
        if np.any(valid_cols):
            stacked_valid = stacked[:, valid_cols]
            min_scores = np.nanmin(stacked_valid, axis=0)
            mean_scores = np.nanmean(stacked_valid, axis=0)
            sub_score[valid_cols] = np.clip(0.60 * min_scores + 0.40 * mean_scores, 0.0, 100.0)

        subsystem_health[sub_name] = sub_score

    return subsystem_health


def compute_overall_health_score(
    subsystem_health_dict: Dict[str, np.ndarray],
) -> np.ndarray:
    """
    Compute overall engine health score from all 8 subsystem scores.

    Aggregation rule:
        overall_health = 0.50 * min(subsystem_health) + 0.50 * mean(subsystem_health)

    Bounded strictly to [0.0, 100.0].
    """
    stacked = np.array(list(subsystem_health_dict.values()), dtype=np.float64)  # shape: (n_subsystems, N)

    all_nan_cols = np.all(np.isnan(stacked), axis=0)
    overall = np.full(stacked.shape[1], np.nan, dtype=np.float64)

    valid_cols = ~all_nan_cols
    if np.any(valid_cols):
        stacked_valid = stacked[:, valid_cols]
        min_sub = np.nanmin(stacked_valid, axis=0)
        mean_sub = np.nanmean(stacked_valid, axis=0)
        overall[valid_cols] = np.clip(0.50 * min_sub + 0.50 * mean_sub, 0.0, 100.0)

    return overall


def generate_subsystem_explanation(
    subsystem_name: str,
    subsystem_score: float,
    sensors_in_subsystem: List[str],
    window_features_row: Union[pd.Series, Dict[str, Any]],
) -> str:
    """
    Generate dynamic, data-driven textual explanation for a subsystem health score.

    Cites the primary offending sensor, observed max |z|, residual direction, mean z-score,
    and physical fault differentiators (e.g. ignition misfire vs lean injection, cooling cascade).

    Args:
        subsystem_name: Name of the subsystem.
        subsystem_score: Calculated health score (0-100).
        sensors_in_subsystem: List of sensor names belonging to this subsystem.
        window_features_row: Series/dict containing window features for the timestep.

    Returns:
        str: Descriptive, explainable sentence.
    """
    if np.isnan(subsystem_score):
        return f"{subsystem_name} health = NaN (insufficient window history, t < 60s)"

    if subsystem_score >= 90.0:
        return f"{subsystem_name} health = {subsystem_score:.1f} (nominal, all sensor residuals within expected bounds)"

    # Identify the sensor with the largest max_abs_z / largest abnormality in this subsystem
    worst_sensor = None
    worst_max_z = -1.0
    worst_mean_z = 0.0

    for s in sensors_in_subsystem:
        max_z_col = f"window_max_abs_z_{s}"
        mean_z_col = f"window_mean_z_{s}"
        if max_z_col in window_features_row and mean_z_col in window_features_row:
            max_z = float(window_features_row[max_z_col])
            mean_z = float(window_features_row[mean_z_col])
            if np.isfinite(max_z) and max_z > worst_max_z:
                worst_max_z = max_z
                worst_mean_z = mean_z
                worst_sensor = s

    if worst_sensor is None or worst_max_z <= 0.0:
        return f"{subsystem_name} health = {subsystem_score:.1f} (mild deviation across sensor channels)"

    direction = "above" if worst_mean_z >= 0 else "below"
    readable_sensor = worst_sensor.replace("_", " ")

    # Physical differentiator cues:
    detail_tag = ""
    if subsystem_name == "cooling" and worst_max_z >= 2.0:
        # Check if multiple CHTs are elevated uniformly
        high_chts = [
            s for s in sensors_in_subsystem
            if s.startswith("cht_") and float(window_features_row.get(f"window_mean_z_{s}", 0.0)) > 1.5
        ]
        if len(high_chts) >= 3:
            detail_tag = " (uniform multi-cylinder thermal elevation / coolant loop failure)"
        elif len(high_chts) == 1:
            detail_tag = f" (isolated single-cylinder thermal distress on {high_chts[0]})"
    elif subsystem_name in ("combustion", "injection") and worst_max_z >= 2.0:
        if worst_mean_z < -2.0:
            detail_tag = " (cylinder temperature drop indicating incomplete combustion / misfire)"
        elif worst_mean_z > 2.0:
            detail_tag = " (elevated combustion temperature indicating lean mixture / injector distress)"
    elif subsystem_name == "lubrication" and worst_max_z >= 2.0:
        oil_p_z = float(window_features_row.get("window_mean_z_oil_press_bar", 0.0))
        oil_t_z = float(window_features_row.get("window_mean_z_oil_temp_c", 0.0))
        if oil_p_z < -2.0 and oil_t_z > 1.5:
            detail_tag = " (confirmed lubrication thermal breakdown: low oil pressure with high oil temperature)"
        elif oil_p_z < -2.0 and abs(oil_t_z) < 1.0:
            detail_tag = " (early pressure drop cascade or uncoupled oil pressure sensor drift)"

    return (
        f"{subsystem_name} health = {subsystem_score:.1f} because {readable_sensor} residual "
        f"reached {worst_max_z:.1f} sigma ({direction} expected, 60s mean {worst_mean_z:+.2f} sigma){detail_tag}."
    )


def generate_overall_explanation(
    overall_score: float,
    subsystem_scores: Dict[str, float],
    subsystem_explanations: Dict[str, str],
) -> str:
    """
    Generate dynamic textual explanation for overall engine health.
    """
    if np.isnan(overall_score):
        return "Overall engine health = NaN (insufficient window history, t < 60s)"

    if overall_score >= 90.0:
        return f"Overall engine health = {overall_score:.1f} (nominal operating condition across all subsystems)"

    # Find the most degraded subsystem
    worst_sub = min(subsystem_scores.keys(), key=lambda k: subsystem_scores[k] if np.isfinite(subsystem_scores[k]) else 100.0)
    worst_sub_score = subsystem_scores[worst_sub]

    return (
        f"Overall engine health = {overall_score:.1f} primary driver: "
        f"{subsystem_explanations[worst_sub]}"
    )


def process_single_flight_health_index(
    flight_window_df: pd.DataFrame,
    flight_id: Optional[str] = None,
    subsystem_map: Optional[Dict[str, List[str]]] = None,
    generate_explanations: bool = True,
) -> pd.DataFrame:
    """
    Process a single flight DataFrame containing Step 11 window features to compute all health indices.

    Preserves:
    - Metadata/identifiers (flight_id, run_id, timestamp, t_s, fault_label, severity, t_to_redline, phase)
    - Context variables (throttle_pct, alt_m, oat_c, ias_kt, phase)
    - All 19 sensor health scores: health_sensor_<sensor>
    - All 8 subsystem health scores: health_subsystem_<subsystem>
    - All 8 subsystem explanations: explanation_<subsystem>
    - Overall engine health: health_overall and explanation_overall

    Args:
        flight_window_df: DataFrame containing Step 11 60s window features.
        flight_id: Optional flight identifier string.
        subsystem_map: Optional mapping of subsystems.
        generate_explanations: Whether to generate textual explanations (default True).

    Returns:
        pd.DataFrame: Comprehensive health index DataFrame.
    """
    subsystems = subsystem_map or SUBSYSTEM_MAP
    n_rows = len(flight_window_df)

    # 1. Compute health scores for all 19 individual sensors
    sensor_health_dict: Dict[str, np.ndarray] = {}
    for s in SENSOR_COLS:
        mean_col = f"window_mean_z_{s}"
        max_col = f"window_max_abs_z_{s}"
        std_col = f"window_std_z_{s}"
        slope_col = f"window_slope_z_{s}"

        if mean_col not in flight_window_df.columns or max_col not in flight_window_df.columns:
            raise KeyError(f"Window feature columns missing for sensor '{s}'. Expected '{mean_col}' and '{max_col}'.")

        s_health = compute_sensor_health_score(
            mean_z=flight_window_df[mean_col].to_numpy(),
            max_abs_z=flight_window_df[max_col].to_numpy(),
            std_z=flight_window_df[std_col].to_numpy() if std_col in flight_window_df.columns else None,
            slope_z=flight_window_df[slope_col].to_numpy() if slope_col in flight_window_df.columns else None,
        )
        sensor_health_dict[s] = s_health

    # 2. Compute 8 subsystem health scores
    subsystem_health_dict = compute_subsystem_health_scores(sensor_health_dict, subsystem_map=subsystems)

    # 3. Compute overall engine health score
    overall_health = compute_overall_health_score(subsystem_health_dict)

    # 4. Generate dynamic explanations if requested
    subsystem_explanations_dict: Dict[str, List[str]] = {sub: [] for sub in subsystems}
    overall_explanations: List[str] = []

    if generate_explanations:
        for idx in range(n_rows):
            row_dict = flight_window_df.iloc[idx].to_dict()
            current_sub_scores = {sub: float(subsystem_health_dict[sub][idx]) for sub in subsystems}
            current_overall = float(overall_health[idx])

            curr_sub_explanations = {}
            for sub, sensors in subsystems.items():
                expl = generate_subsystem_explanation(
                    subsystem_name=sub,
                    subsystem_score=current_sub_scores[sub],
                    sensors_in_subsystem=sensors,
                    window_features_row=row_dict,
                )
                subsystem_explanations_dict[sub].append(expl)
                curr_sub_explanations[sub] = expl

            ov_expl = generate_overall_explanation(
                overall_score=current_overall,
                subsystem_scores=current_sub_scores,
                subsystem_explanations=curr_sub_explanations,
            )
            overall_explanations.append(ov_expl)

    # 5. Assemble result DataFrame cleanly
    data_dict: Dict[str, Any] = {}

    if flight_id is not None and "flight_id" not in flight_window_df.columns and "run_id" not in flight_window_df.columns:
        data_dict["flight_id"] = [flight_id] * n_rows

    # Preserve all existing columns from input dataframe
    for col in flight_window_df.columns:
        data_dict[col] = flight_window_df[col].to_numpy()

    # Append sensor health scores
    for s in SENSOR_COLS:
        data_dict[f"health_sensor_{s}"] = sensor_health_dict[s]

    # Append subsystem health scores
    for sub in subsystems:
        data_dict[f"health_subsystem_{sub}"] = subsystem_health_dict[sub]

    # Append overall health score
    data_dict["health_overall"] = overall_health

    # Append explanations
    if generate_explanations:
        for sub in subsystems:
            data_dict[f"explanation_{sub}"] = subsystem_explanations_dict[sub]
        data_dict["explanation_overall"] = overall_explanations

    return pd.DataFrame(data_dict, index=flight_window_df.index)


def generate_health_index_config(
    subsystem_map: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    """
    Generate the health index metadata configuration documentation.
    """
    subsystems = subsystem_map or SUBSYSTEM_MAP
    total_sensors = sum(len(v) for v in subsystems.values())

    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "step": 12,
        "type": "Rule-Based Health Index (Deterministic)",
        "score_range": [0.0, 100.0],
        "subsystem_count": len(subsystems),
        "total_sensors_mapped": total_sensors,
        "subsystem_mapping": subsystems,
        "formulas": {
            "sensor_penalty": "penalty = 0.55 * |window_mean_z| + 0.35 * window_max_abs_z + 0.10 * window_std_z + 5.0 * |window_slope_z|",
            "sensor_health": "health = clip(100.0 * exp(-max(0, penalty - 1.0) / 3.0), 0.0, 100.0)",
            "subsystem_health": "subsystem_health = 0.60 * min(sensor_health_in_subsystem) + 0.40 * mean(sensor_health_in_subsystem)",
            "overall_health": "overall_health = 0.50 * min(subsystem_health) + 0.50 * mean(subsystem_health)",
        },
        "thresholds": {
            "nominal_noise_tolerance_sigma": 1.0,
            "decay_scale_constant": 3.0,
            "subsystem_min_weight": 0.60,
            "subsystem_mean_weight": 0.40,
            "overall_min_weight": 0.50,
            "overall_mean_weight": 0.50,
        },
        "health_score_interpretation": {
            "90_100": "Healthy / Nominal operating condition",
            "70_89": "Mild deviation / Early degradation warning",
            "40_69": "Moderate abnormality / Actionable maintenance required",
            "0_39": "Severe fault / Critical subsystem failure risk",
        },
        "boundary_handling": {
            "flight_isolation": "Health index is computed per flight independently. No cross-flight contamination.",
            "incomplete_windows": "Timesteps t < 60s evaluate to NaN due to incomplete rolling window history.",
        },
    }


def save_health_index_config(
    output_path: Union[str, Path],
    subsystem_map: Optional[Dict[str, List[str]]] = None,
) -> Path:
    """
    Save health_index_config.json to destination directory.
    """
    target = Path(output_path)
    if target.is_dir() or target.suffix != ".json":
        target = target / "health_index_config.json"

    target.parent.mkdir(parents=True, exist_ok=True)
    config = generate_health_index_config(subsystem_map=subsystem_map)

    with open(target, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    return target
