"""
Rolling Window Feature Extraction Module for R2 ML.

Step 11: 60-second rolling window feature extraction from z-score residual data.
- Converts timestep-level z-score residuals into temporal 60-second window features.
- Automatically discovers all 19 sensor channels from project schema.
- Calculates 4 features per sensor over a 60-second (60 samples) rolling window:
    1. window_mean_z_<sensor>: Mean of z-score residuals over the 60s window.
    2. window_std_z_<sensor>: Sample standard deviation (ddof=1) over the 60s window.
    3. window_slope_z_<sensor>: Linear regression slope of z-score against time over the 60s window.
    4. window_max_abs_z_<sensor>: Maximum absolute z-score over the 60s window.
- Exactly 19 sensors * 4 features = 76 rolling window features.
- Strictly preserves flight boundaries: No rolling window ever crosses flight boundaries.
- Incomplete initial windows (< 60 samples, i.e. rows 0..58) evaluate to NaN.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import numpy as np
import pandas as pd

from src.preprocessing.schema import CONTEXT_COLS, SENSOR_COLS, METADATA_COLS

WINDOW_SECONDS: int = 60
SAMPLES_PER_WINDOW: int = 60
FEATURES_PER_SENSOR: List[str] = ["mean", "std", "slope", "max_abs"]
TOTAL_WINDOW_FEATURES: int = len(SENSOR_COLS) * len(FEATURES_PER_SENSOR)  # 19 * 4 = 76


def compute_rolling_slope(
    series: Union[np.ndarray, pd.Series],
    window_size: int = SAMPLES_PER_WINDOW,
) -> np.ndarray:
    """
    Compute exact linear regression slope of series against time (t = 0..W-1) over rolling window.

    For equidistant time samples x = [0, 1, ..., W-1], the ordinary least squares slope is:
        slope = sum((x_i - mean_x) * y_i) / sum((x_i - mean_x)^2)
    This is equivalent to a linear finite impulse response (FIR) filter / convolution.

    Args:
        series: 1D array or Series of numeric values (e.g. z-scores).
        window_size: Number of samples in the rolling window (default 60).

    Returns:
        np.ndarray: Array of rolling slopes, with NaN for the initial window_size - 1 samples.
    """
    y = np.asarray(series, dtype=np.float64)
    n = len(y)
    out = np.full(n, np.nan, dtype=np.float64)

    if n < window_size:
        return out

    # x coordinates: 0, 1, ..., W-1 (1-second intervals)
    x = np.arange(window_size, dtype=np.float64)
    x_mean = (window_size - 1.0) / 2.0
    x_dev = x - x_mean
    denom = np.sum(x_dev ** 2)  # W * (W^2 - 1) / 12 for integers

    # Weights for convolution: w_i = (x_i - x_mean) / denom
    # Because convolution in numpy is y * w[::-1], we reverse weights for chronological order
    weights = x_dev / denom
    kernel = weights[::-1]

    # Compute valid convolution
    valid_slopes = np.convolve(y, kernel, mode="valid")
    out[window_size - 1:] = valid_slopes

    return out


def compute_sensor_window_features(
    z_series: Union[np.ndarray, pd.Series],
    sensor_name: str,
    window_size: int = SAMPLES_PER_WINDOW,
) -> Dict[str, np.ndarray]:
    """
    Compute 4 rolling window features for a single sensor's z-score series.

    Features generated:
    - window_mean_z_<sensor>: Rolling mean with min_periods=window_size
    - window_std_z_<sensor>: Rolling sample std (ddof=1) with min_periods=window_size
    - window_slope_z_<sensor>: Rolling linear regression slope with min_periods=window_size
    - window_max_abs_z_<sensor>: Rolling max of absolute value with min_periods=window_size

    Args:
        z_series: 1D array or Series of z-scores for a single sensor.
        sensor_name: Name of the sensor channel.
        window_size: Rolling window length (default 60 samples).

    Returns:
        Dict[str, np.ndarray]: Dictionary mapping feature column name to feature array.
    """
    s = pd.Series(z_series, dtype=np.float64)

    # Rolling mean
    rolling_obj = s.rolling(window=window_size, min_periods=window_size)
    mean_z = rolling_obj.mean().to_numpy()

    # Rolling std (sample standard deviation, ddof=1)
    std_z = rolling_obj.std(ddof=1).to_numpy()

    # Rolling slope
    slope_z = compute_rolling_slope(s.to_numpy(), window_size=window_size)

    # Rolling max absolute z-score
    abs_s = s.abs()
    max_abs_z = abs_s.rolling(window=window_size, min_periods=window_size).max().to_numpy()

    return {
        f"window_mean_z_{sensor_name}": mean_z,
        f"window_std_z_{sensor_name}": std_z,
        f"window_slope_z_{sensor_name}": slope_z,
        f"window_max_abs_z_{sensor_name}": max_abs_z,
    }


def compute_rolling_window_features(
    flight_df: pd.DataFrame,
    sensor_cols: Optional[List[str]] = None,
    window_size: int = SAMPLES_PER_WINDOW,
) -> pd.DataFrame:
    """
    Compute 76 rolling window features (19 sensors * 4 features) for a single flight.

    Args:
        flight_df: DataFrame containing flight telemetry with z-score columns
                   (expects 'z_score_<sensor>' or 'z_<sensor>').
        sensor_cols: Optional list of sensor columns (defaults to SENSOR_COLS).
        window_size: Rolling window size (default 60).

    Returns:
        pd.DataFrame: DataFrame containing exactly 76 window feature columns.
    """
    sensors = sensor_cols or SENSOR_COLS
    features_dict: Dict[str, np.ndarray] = {}

    for sensor in sensors:
        # Check for z-score column
        z_col = None
        if f"z_score_{sensor}" in flight_df.columns:
            z_col = f"z_score_{sensor}"
        elif f"z_{sensor}" in flight_df.columns:
            z_col = f"z_{sensor}"
        else:
            raise KeyError(
                f"Flight data missing z-score column for sensor '{sensor}'. "
                f"Expected 'z_score_{sensor}' or 'z_{sensor}'."
            )

        sensor_features = compute_sensor_window_features(
            flight_df[z_col],
            sensor_name=sensor,
            window_size=window_size,
        )
        features_dict.update(sensor_features)

    return pd.DataFrame(features_dict, index=flight_df.index)


def process_single_flight_windows(
    flight_residuals_df: pd.DataFrame,
    flight_id: Optional[str] = None,
    sensor_cols: Optional[List[str]] = None,
    window_size: int = SAMPLES_PER_WINDOW,
) -> pd.DataFrame:
    """
    Process a single flight DataFrame to compute rolling window features while preserving metadata.

    Preserves:
    - Metadata/flight identifiers (run_id, flight_id, timestamp, t_s, fault_label, severity, t_to_redline)
    - Context variables (throttle_pct, alt_m, oat_c, ias_kt, phase)
    - Raw sensor readings, predicted values, residuals, and z-scores
    - 76 window feature columns

    Args:
        flight_residuals_df: DataFrame containing flight telemetry and residual z-scores.
        flight_id: Optional flight identifier string.
        sensor_cols: Optional list of sensor channels (defaults to SENSOR_COLS).
        window_size: Window size in seconds/samples (default 60).

    Returns:
        pd.DataFrame: Comprehensive flight DataFrame with window features included.
    """
    sensors = sensor_cols or SENSOR_COLS

    # Compute 76 window features
    window_features_df = compute_rolling_window_features(
        flight_residuals_df,
        sensor_cols=sensors,
        window_size=window_size,
    )

    # Assemble complete DataFrame cleanly
    data_dict: Dict[str, Any] = {}

    if flight_id is not None and "flight_id" not in flight_residuals_df.columns and "run_id" not in flight_residuals_df.columns:
        data_dict["flight_id"] = [flight_id] * len(flight_residuals_df)

    # Preserve all existing columns from input residual dataframe in order
    for col in flight_residuals_df.columns:
        data_dict[col] = flight_residuals_df[col].to_numpy()

    # Append the 76 rolling window features
    for col in window_features_df.columns:
        data_dict[col] = window_features_df[col].to_numpy()

    return pd.DataFrame(data_dict, index=flight_residuals_df.index)


def generate_window_config(
    sensor_cols: Optional[List[str]] = None,
    window_size: int = SAMPLES_PER_WINDOW,
) -> Dict[str, Any]:
    """
    Generate window features metadata configuration dictionary.

    Args:
        sensor_cols: Optional list of sensor channels (defaults to SENSOR_COLS).
        window_size: Window size in seconds/samples.

    Returns:
        Dict[str, Any]: Configuration dictionary to be stored in window_config.json.
    """
    sensors = sensor_cols or SENSOR_COLS
    n_sensors = len(sensors)
    n_features_per_sensor = len(FEATURES_PER_SENSOR)
    total_features = n_sensors * n_features_per_sensor

    expected_feature_names: List[str] = []
    for s in sensors:
        for f in FEATURES_PER_SENSOR:
            expected_feature_names.append(f"window_{f}_z_{s}")

    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "step": 11,
        "description": "60-second rolling window feature extraction from nominal digital twin z-score residuals",
        "WINDOW_SECONDS": window_size,
        "samples_per_window": window_size,
        "sample_rate_hz": 1.0,
        "sensor_count": n_sensors,
        "sensors": sensors,
        "features_per_sensor": n_features_per_sensor,
        "feature_types": FEATURES_PER_SENSOR,
        "total_window_features": total_features,
        "feature_definitions": {
            "window_mean_z_<sensor>": "Mean of z-score residuals over the preceding 60-second window (min_periods=60).",
            "window_std_z_<sensor>": "Sample standard deviation (ddof=1) of z-score residuals over the preceding 60-second window (min_periods=60).",
            "window_slope_z_<sensor>": "Linear regression slope (d(z)/dt) of z-score residuals over the preceding 60-second window (min_periods=60).",
            "window_max_abs_z_<sensor>": "Maximum absolute z-score value max(|z|) over the preceding 60-second window (min_periods=60).",
        },
        "boundary_handling": {
            "flight_isolation": "Windows are calculated per flight independently. Windows NEVER cross flight boundaries.",
            "initial_window_policy": "The first 59 samples (t=0..58s) have incomplete history and evaluate to NaN. Exactly 60 samples are required for valid window features.",
        },
        "feature_names": expected_feature_names,
    }


def save_window_config(
    output_path: Union[str, Path],
    sensor_cols: Optional[List[str]] = None,
    window_size: int = SAMPLES_PER_WINDOW,
) -> Path:
    """
    Save window_config.json to target directory.

    Args:
        output_path: Path or directory where window_config.json will be saved.
        sensor_cols: Optional list of sensor channels.
        window_size: Window size in seconds.

    Returns:
        Path: Saved file path.
    """
    target = Path(output_path)
    if target.is_dir() or target.suffix != ".json":
        target = target / "window_config.json"

    target.parent.mkdir(parents=True, exist_ok=True)
    config_dict = generate_window_config(sensor_cols=sensor_cols, window_size=window_size)

    with open(target, "w", encoding="utf-8") as f:
        json.dump(config_dict, f, indent=2)

    return target
