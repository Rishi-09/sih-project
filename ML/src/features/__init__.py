"""
Feature Engineering Package for R2 ML.
"""

from src.features.residual_features import (
    compute_residuals,
    compute_healthy_residual_statistics,
    compute_z_scores,
    process_single_flight_residuals,
)
from src.features.window_features import (
    compute_rolling_slope,
    compute_sensor_window_features,
    compute_rolling_window_features,
    process_single_flight_windows,
    generate_window_config,
    save_window_config,
    WINDOW_SECONDS,
    SAMPLES_PER_WINDOW,
    FEATURES_PER_SENSOR,
    TOTAL_WINDOW_FEATURES,
)

__all__ = [
    "compute_residuals",
    "compute_healthy_residual_statistics",
    "compute_z_scores",
    "process_single_flight_residuals",
    "compute_rolling_slope",
    "compute_sensor_window_features",
    "compute_rolling_window_features",
    "process_single_flight_windows",
    "generate_window_config",
    "save_window_config",
    "WINDOW_SECONDS",
    "SAMPLES_PER_WINDOW",
    "FEATURES_PER_SENSOR",
    "TOTAL_WINDOW_FEATURES",
]
