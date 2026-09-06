"""
Remaining Useful Life (RUL) Prognosis Module for R2 ML.

Step 15: Rule-Based Prognosis / Remaining Useful Life Estimation.
- Takes the rule-based overall health index trend over the recent few minutes.
- Fits an ordinary least-squares linear trend: health_score = slope * time + intercept.
- Extrapolates the trajectory to a configurable failure threshold (FAILURE_HEALTH_THRESHOLD = 20).
- Pure mathematical extrapolation (NOT an ML model).
- Strictly isolated from ground-truth t_to_redline (t_to_redline is used ONLY for offline evaluation).
- Returns None/null when health is stable, improving, or history is insufficient.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd

DEFAULT_RUL_TREND_WINDOW_SECONDS: int = 300
DEFAULT_FAILURE_HEALTH_THRESHOLD: float = 20.0
MIN_SAMPLES_FOR_TREND: int = 30


def fit_health_trend(
    timestamps: np.ndarray,
    health_scores: np.ndarray,
) -> Tuple[float, float, float]:
    """
    Fit linear regression: health_score = slope * time + intercept.

    Args:
        timestamps: 1D array of time values in seconds.
        health_scores: 1D array of health scores.

    Returns:
        Tuple[float, float, float]: (slope, intercept, r_squared)
    """
    t = np.asarray(timestamps, dtype=np.float64)
    h = np.asarray(health_scores, dtype=np.float64)

    n = len(t)
    if n < 2:
        return 0.0, float(h[0]) if n == 1 else 100.0, 0.0

    t_mean = np.mean(t)
    h_mean = np.mean(h)

    t_dev = t - t_mean
    h_dev = h - h_mean

    denom = np.sum(t_dev ** 2)
    if denom < 1e-12:
        return 0.0, h_mean, 0.0

    slope = float(np.sum(t_dev * h_dev) / denom)
    intercept = float(h_mean - slope * t_mean)

    # R-squared
    ss_tot = np.sum(h_dev ** 2)
    h_pred = slope * t + intercept
    ss_res = np.sum((h - h_pred) ** 2)

    r_squared = float(1.0 - (ss_res / ss_tot)) if ss_tot > 1e-12 else 1.0
    r_squared = max(0.0, min(1.0, r_squared))

    return slope, intercept, r_squared


def estimate_rul(
    health_history: Union[pd.DataFrame, pd.Series, List[float], np.ndarray],
    timestamps: Optional[Union[pd.Series, np.ndarray, List[float]]] = None,
    trend_window_seconds: int = DEFAULT_RUL_TREND_WINDOW_SECONDS,
    failure_threshold: float = DEFAULT_FAILURE_HEALTH_THRESHOLD,
    min_samples: int = MIN_SAMPLES_FOR_TREND,
) -> Dict[str, Any]:
    """
    Estimate Remaining Useful Life (RUL) in seconds from recent health index history.

    Args:
        health_history: Sequence of health index scores (or DataFrame with 'health_overall').
        timestamps: Optional sequence of timestamps in seconds (or inferred as 1s step).
        trend_window_seconds: Duration of recent history window in seconds (default 300s).
        failure_threshold: Health score failure redline (default 20.0).
        min_samples: Minimum required samples to calculate a trend (default 30).

    Returns:
        Dict[str, Any]:
        {
            "remaining_useful_life": float or None,
            "failure_threshold": float,
            "trend_slope": float or None,
            "trend_window_seconds": int,
            "current_health": float or None,
            "r_squared": float or None,
            "n_samples_used": int,
            "explanation": str
        }
    """
    # 1. Parse inputs
    if isinstance(health_history, pd.DataFrame):
        if "health_overall" in health_history.columns:
            h_vals = health_history["health_overall"].to_numpy()
        elif "health_engine" in health_history.columns:
            h_vals = health_history["health_engine"].to_numpy()
        else:
            # First numeric column
            h_vals = health_history.iloc[:, 0].to_numpy()

        if timestamps is None and "t_s" in health_history.columns:
            t_vals = health_history["t_s"].to_numpy()
        elif timestamps is None and "timestamp" in health_history.columns:
            t_vals = health_history["timestamp"].to_numpy()
        else:
            t_vals = np.asarray(timestamps) if timestamps is not None else np.arange(len(h_vals), dtype=np.float64)
    else:
        h_vals = np.asarray(health_history, dtype=np.float64)
        t_vals = np.asarray(timestamps, dtype=np.float64) if timestamps is not None else np.arange(len(h_vals), dtype=np.float64)

    # 2. Filter valid (non-NaN) samples
    valid_mask = np.isfinite(h_vals) & np.isfinite(t_vals)
    h_clean = h_vals[valid_mask]
    t_clean = t_vals[valid_mask]

    if len(h_clean) < min_samples:
        return {
            "remaining_useful_life": None,
            "failure_threshold": float(failure_threshold),
            "trend_slope": None,
            "trend_window_seconds": trend_window_seconds,
            "current_health": float(h_clean[-1]) if len(h_clean) > 0 else None,
            "r_squared": None,
            "n_samples_used": len(h_clean),
            "explanation": f"Insufficient health history ({len(h_clean)} samples < {min_samples} minimum required).",
        }

    # 3. Select recent window [t_now - trend_window_seconds, t_now]
    t_now = t_clean[-1]
    window_start_t = t_now - trend_window_seconds
    window_mask = t_clean >= window_start_t

    t_win = t_clean[window_mask]
    h_win = h_clean[window_mask]

    if len(h_win) < min_samples:
        return {
            "remaining_useful_life": None,
            "failure_threshold": float(failure_threshold),
            "trend_slope": None,
            "trend_window_seconds": trend_window_seconds,
            "current_health": float(h_win[-1]),
            "r_squared": None,
            "n_samples_used": len(h_win),
            "explanation": f"Insufficient recent window samples ({len(h_win)} in past {trend_window_seconds}s).",
        }

    # 4. Fit linear trend over recent window
    slope, intercept, r2 = fit_health_trend(t_win, h_win)
    current_health = float(h_win[-1])
    start_health = float(h_win[0])
    actual_duration = float(t_win[-1] - t_win[0])

    # 5. Check already failed condition
    if current_health <= failure_threshold:
        return {
            "remaining_useful_life": 0.0,
            "failure_threshold": float(failure_threshold),
            "trend_slope": slope,
            "trend_window_seconds": trend_window_seconds,
            "current_health": current_health,
            "r_squared": r2,
            "n_samples_used": len(h_win),
            "explanation": f"Health index ({current_health:.1f}) is already at or below failure threshold ({failure_threshold:.1f}); RUL is 0 s.",
        }

    # 6. Check slope direction: if flat or improving (slope >= -1e-5), threshold is not reached
    if slope >= -1e-5:
        return {
            "remaining_useful_life": None,
            "failure_threshold": float(failure_threshold),
            "trend_slope": slope,
            "trend_window_seconds": trend_window_seconds,
            "current_health": current_health,
            "r_squared": r2,
            "n_samples_used": len(h_win),
            "explanation": f"Health index is stable/improving (slope: {slope:+.4f}/s, current health: {current_health:.1f}); failure threshold ({failure_threshold:.1f}) is not projected to be reached.",
        }

    # 7. Extrapolate to failure threshold: failure_threshold = slope * t_fail + intercept
    # RUL = (failure_threshold - current_health) / slope
    # Since slope < 0 and current_health > failure_threshold:
    rul_seconds = (failure_threshold - current_health) / slope
    rul_seconds = max(0.0, float(rul_seconds))

    explanation = (
        f"Health index declined from {start_health:.1f} to {current_health:.1f} over recent {actual_duration:.0f}s window "
        f"(slope: {slope:.4f}/s, R2={r2:.2f}); linear extrapolation reaches failure threshold ({failure_threshold:.1f}) "
        f"in approximately {rul_seconds:.0f} s."
    )

    return {
        "remaining_useful_life": rul_seconds,
        "failure_threshold": float(failure_threshold),
        "trend_slope": slope,
        "trend_window_seconds": trend_window_seconds,
        "current_health": current_health,
        "r_squared": r2,
        "n_samples_used": len(h_win),
        "explanation": explanation,
    }


def compute_flight_rul_series(
    flight_df: pd.DataFrame,
    health_col: str = "health_overall",
    time_col: str = "t_s",
    trend_window_seconds: int = DEFAULT_RUL_TREND_WINDOW_SECONDS,
    failure_threshold: float = DEFAULT_FAILURE_HEALTH_THRESHOLD,
    min_samples: int = MIN_SAMPLES_FOR_TREND,
) -> pd.DataFrame:
    """
    Compute sequential rolling RUL estimates across every timestep in a single flight.

    Args:
        flight_df: DataFrame containing flight health index history.
        health_col: Health score column name (default 'health_overall').
        time_col: Timestamp column name (default 't_s').
        trend_window_seconds: Rolling trend window in seconds (default 300).
        failure_threshold: Health score failure threshold (default 20.0).

    Returns:
        pd.DataFrame: DataFrame containing 'estimated_rul', 'rul_trend_slope', 'rul_explanation'.
    """
    n_rows = len(flight_df)
    ruls: List[Optional[float]] = [None] * n_rows
    slopes: List[Optional[float]] = [None] * n_rows
    explanations: List[str] = [""] * n_rows

    if health_col not in flight_df.columns:
        raise KeyError(f"Health column '{health_col}' missing from DataFrame.")

    t_arr = flight_df[time_col].to_numpy() if time_col in flight_df.columns else np.arange(n_rows, dtype=np.float64)
    h_arr = flight_df[health_col].to_numpy()

    # Iterate chronologically (simulate streaming evaluation)
    for i in range(n_rows):
        if not np.isfinite(h_arr[i]):
            explanations[i] = "Insufficient window history (t < 60s)"
            continue

        # Look back up to trend_window_seconds
        current_t = t_arr[i]
        start_idx = max(0, i - trend_window_seconds)

        sub_t = t_arr[start_idx : i + 1]
        sub_h = h_arr[start_idx : i + 1]

        res = estimate_rul(
            health_history=sub_h,
            timestamps=sub_t,
            trend_window_seconds=trend_window_seconds,
            failure_threshold=failure_threshold,
            min_samples=min_samples,
        )

        ruls[i] = res["remaining_useful_life"]
        slopes[i] = res["trend_slope"]
        explanations[i] = res["explanation"]

    return pd.DataFrame({
        "estimated_rul": ruls,
        "rul_trend_slope": slopes,
        "rul_explanation": explanations,
    }, index=flight_df.index)


def generate_rul_config(
    trend_window_seconds: int = DEFAULT_RUL_TREND_WINDOW_SECONDS,
    failure_threshold: float = DEFAULT_FAILURE_HEALTH_THRESHOLD,
    min_samples: int = MIN_SAMPLES_FOR_TREND,
) -> Dict[str, Any]:
    """Generate RUL configuration documentation."""
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "step": 15,
        "method": "Rule-Based Linear Trend Extrapolation (OLS)",
        "trend_window_seconds": trend_window_seconds,
        "failure_health_threshold": failure_threshold,
        "min_samples_for_trend": min_samples,
        "formula": {
            "linear_fit": "health(t) = slope * t + intercept",
            "extrapolation": "RUL = (failure_threshold - current_health) / slope (for slope < 0)",
            "non_declining_policy": "If slope >= 0, RUL is null/None.",
            "non_negativity": "RUL = max(0.0, RUL)",
        },
        "data_leakage_policy": "t_to_redline is strictly excluded from inputs and used ONLY for offline ground-truth evaluation.",
    }


def save_rul_config(
    output_path: Union[str, Path],
    trend_window_seconds: int = DEFAULT_RUL_TREND_WINDOW_SECONDS,
    failure_threshold: float = DEFAULT_FAILURE_HEALTH_THRESHOLD,
    min_samples: int = MIN_SAMPLES_FOR_TREND,
) -> Path:
    """Save rul_config.json to target destination."""
    target = Path(output_path)
    if target.is_dir() or target.suffix != ".json":
        target = target / "rul_config.json"

    target.parent.mkdir(parents=True, exist_ok=True)
    config = generate_rul_config(
        trend_window_seconds=trend_window_seconds,
        failure_threshold=failure_threshold,
        min_samples=min_samples,
    )

    with open(target, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    return target
