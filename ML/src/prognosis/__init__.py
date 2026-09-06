"""
Prognosis and Remaining Useful Life (RUL) Package for R2 ML.
"""

from src.prognosis.rul import (
    fit_health_trend,
    estimate_rul,
    compute_flight_rul_series,
    generate_rul_config,
    save_rul_config,
    DEFAULT_RUL_TREND_WINDOW_SECONDS,
    DEFAULT_FAILURE_HEALTH_THRESHOLD,
    MIN_SAMPLES_FOR_TREND,
)

__all__ = [
    "fit_health_trend",
    "estimate_rul",
    "compute_flight_rul_series",
    "generate_rul_config",
    "save_rul_config",
    "DEFAULT_RUL_TREND_WINDOW_SECONDS",
    "DEFAULT_FAILURE_HEALTH_THRESHOLD",
    "MIN_SAMPLES_FOR_TREND",
]
