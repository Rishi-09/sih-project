"""
Residual and Z-score Feature Extraction Module for R2 ML.

Step 10: Residual and Z-score computation for the Nominal Digital Twin.
- Uses trained NominalDigitalTwin to predict all 19 sensor channels.
- Calculates:
    residual = actual_sensor_value - predicted_sensor_value
- Computes baseline residual statistics on HEALTHY-ONLY data:
    healthy_residual_std (and mean, min, max)
- Calculates z-scores preserving residual sign:
    z_score = residual / healthy_residual_std
- Preserves original flight telemetry metadata and context variables.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd

from src.models.nominal_twin import NominalDigitalTwin
from src.preprocessing.schema import CONTEXT_COLS, SENSOR_COLS, METADATA_COLS


def compute_residuals(
    actual_df: pd.DataFrame,
    predicted_df: pd.DataFrame,
    sensor_cols: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Calculate residuals: actual_sensor_value - predicted_sensor_value for each sensor channel.

    Args:
        actual_df: DataFrame containing actual ground-truth sensor telemetry.
        predicted_df: DataFrame containing NominalDigitalTwin sensor predictions.
        sensor_cols: Optional list of sensor column names (defaults to SENSOR_COLS).

    Returns:
        pd.DataFrame: DataFrame containing columns 'residual_<sensor>' and 'res_<sensor>'.
    """
    sensors = sensor_cols or SENSOR_COLS
    res_dict: Dict[str, np.ndarray] = {}

    for sensor in sensors:
        if sensor not in actual_df.columns:
            raise KeyError(f"Actual telemetry missing sensor column '{sensor}'.")
        if sensor not in predicted_df.columns:
            raise KeyError(f"Predicted telemetry missing sensor column '{sensor}'.")

        y_true = actual_df[sensor].to_numpy(dtype=np.float64)
        y_pred = predicted_df[sensor].to_numpy(dtype=np.float64)
        res = y_true - y_pred

        res_dict[f"residual_{sensor}"] = res
        res_dict[f"res_{sensor}"] = res

    return pd.DataFrame(res_dict, index=actual_df.index)


def compute_healthy_residual_statistics(
    healthy_residuals_df: pd.DataFrame,
    sensor_cols: Optional[List[str]] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Calculate healthy-only baseline residual statistics (mean, std, min, max) per sensor channel.

    Args:
        healthy_residuals_df: DataFrame containing residuals computed strictly on healthy rows.
        sensor_cols: Optional list of sensor column names (defaults to SENSOR_COLS).

    Returns:
        Dict[str, Dict[str, float]]: Mapping of sensor -> {'mean': float, 'std': float, 'min': float, 'max': float}.
    """
    sensors = sensor_cols or SENSOR_COLS
    stats: Dict[str, Dict[str, float]] = {}

    for sensor in sensors:
        res_col = f"residual_{sensor}" if f"residual_{sensor}" in healthy_residuals_df.columns else f"res_{sensor}"
        if res_col not in healthy_residuals_df.columns:
            if sensor in healthy_residuals_df.columns:
                res_col = sensor
            else:
                raise KeyError(f"Residual column for '{sensor}' not found in healthy residuals DataFrame.")

        vals = healthy_residuals_df[res_col].to_numpy(dtype=np.float64)
        mean_val = float(np.mean(vals))
        std_val = float(np.std(vals, ddof=1))
        # Ensure std is non-zero
        if std_val < 1e-8:
            std_val = 1.0

        stats[sensor] = {
            "mean": mean_val,
            "std": std_val,
            "min": float(np.min(vals)),
            "max": float(np.max(vals)),
        }

    return stats


def compute_z_scores(
    residuals_df: pd.DataFrame,
    healthy_stats: Dict[str, Dict[str, float]],
    sensor_cols: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Calculate residual z-scores: z_score = residual / healthy_residual_std.
    Preserves the sign of the residual.

    Args:
        residuals_df: DataFrame containing residual columns.
        healthy_stats: Baseline statistics computed from healthy-only data.
        sensor_cols: Optional list of sensor column names (defaults to SENSOR_COLS).

    Returns:
        pd.DataFrame: DataFrame containing columns 'z_score_<sensor>' and 'z_<sensor>'.
    """
    sensors = sensor_cols or SENSOR_COLS
    z_dict: Dict[str, np.ndarray] = {}

    for sensor in sensors:
        if sensor not in healthy_stats:
            raise KeyError(f"Sensor '{sensor}' not found in healthy_stats.")

        res_col = f"residual_{sensor}" if f"residual_{sensor}" in residuals_df.columns else f"res_{sensor}"
        if res_col not in residuals_df.columns:
            if sensor in residuals_df.columns:
                res_col = sensor
            else:
                raise KeyError(f"Residual column for '{sensor}' not found in residuals DataFrame.")

        res_vals = residuals_df[res_col].to_numpy(dtype=np.float64)
        healthy_std = healthy_stats[sensor]["std"]
        if healthy_std < 1e-8:
            healthy_std = 1.0

        z_vals = res_vals / healthy_std
        z_dict[f"z_score_{sensor}"] = z_vals
        z_dict[f"z_{sensor}"] = z_vals

    return pd.DataFrame(z_dict, index=residuals_df.index)


def process_single_flight_residuals(
    flight_df: pd.DataFrame,
    twin: NominalDigitalTwin,
    healthy_stats: Dict[str, Dict[str, float]],
    flight_id: Optional[str] = None,
) -> pd.DataFrame:
    """
    Process a single flight DataFrame:
    1. Generate NominalDigitalTwin predictions using context inputs.
    2. Compute sensor residuals (actual - predicted).
    3. Compute residual z-scores (residual / healthy_residual_std).
    4. Assemble full telemetry DataFrame preserving metadata and context.

    Args:
        flight_df: Raw flight telemetry DataFrame.
        twin: Fitted NominalDigitalTwin instance.
        healthy_stats: Baseline healthy residual statistics.
        flight_id: Optional flight identifier.

    Returns:
        pd.DataFrame: Complete processed DataFrame with residuals and z-scores.
    """
    # 1. Predict 19 sensors from 5 context features
    predicted_df = twin.predict(flight_df[CONTEXT_COLS])

    # 2. Compute residuals
    residuals_df = compute_residuals(flight_df, predicted_df, SENSOR_COLS)

    # 3. Compute z-scores
    z_scores_df = compute_z_scores(residuals_df, healthy_stats, SENSOR_COLS)

    # 4. Construct comprehensive result DataFrame cleanly
    data_dict: Dict[str, Any] = {}

    # Metadata & flight identifier
    if flight_id is not None and "flight_id" not in flight_df.columns and "run_id" not in flight_df.columns:
        data_dict["flight_id"] = [flight_id] * len(flight_df)

    for col in flight_df.columns:
        if col in ["t_s", "timestamp", "flight_id", "run_id", "fault_label", "severity", "t_to_redline"] + CONTEXT_COLS:
            data_dict[col] = flight_df[col].to_numpy()

    # Actual sensor columns
    for sensor in SENSOR_COLS:
        if sensor in flight_df.columns:
            data_dict[sensor] = flight_df[sensor].to_numpy()

    # Predicted sensor columns
    for sensor in SENSOR_COLS:
        data_dict[f"pred_{sensor}"] = predicted_df[sensor].to_numpy()

    # Residual columns
    for sensor in SENSOR_COLS:
        data_dict[f"residual_{sensor}"] = residuals_df[f"residual_{sensor}"].to_numpy()
        data_dict[f"res_{sensor}"] = residuals_df[f"res_{sensor}"].to_numpy()

    # Z-score columns
    for sensor in SENSOR_COLS:
        data_dict[f"z_score_{sensor}"] = z_scores_df[f"z_score_{sensor}"].to_numpy()
        data_dict[f"z_{sensor}"] = z_scores_df[f"z_{sensor}"].to_numpy()

    # Ensure any remaining metadata columns from raw flight_df are preserved
    for col in flight_df.columns:
        if col not in data_dict:
            data_dict[col] = flight_df[col].to_numpy()

    return pd.DataFrame(data_dict, index=flight_df.index)
