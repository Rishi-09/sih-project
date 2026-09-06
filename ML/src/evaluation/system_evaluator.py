"""
Full-System Evaluation and Evidence Module for R2 ML.

Step 17: Full-System Validation and Evidence Pack.
- Evaluates the complete integrated ML inference pipeline across all 200 simulator flights.
- Strict run-level separation (160 train flights, 40 test flights).
- Evaluates:
  1. Flight-Level Confusion Matrix on held-out test flights.
  2. False Alarm Rate per healthy flight-hour.
  3. Detection Lead Time (seconds before redline) for faulty flights.
  4. Health Index trajectory validation (healthy vs faulty flights).
  5. Anomaly Detector (Model 3) distribution and detection rates.
  6. Remaining Useful Life (RUL) prognosis accuracy against ground-truth t_to_redline.
  7. Residual vs Raw-Sensor Ablation (temporary evaluation-only model).
  8. Fault-by-fault performance table.
"""

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import confusion_matrix, accuracy_score, f1_score, classification_report

from src.inference.predict import InferencePipeline
from src.preprocessing.schema import CONTEXT_COLS, SENSOR_COLS


def aggregate_flight_prediction(
    predicted_faults: List[str],
    confidences: List[float],
    anomalies: List[bool],
) -> Tuple[str, float]:
    """
    Convert a temporal sequence of window predictions into a single flight-level diagnosis.

    Aggregation Rule:
    1. If no non-healthy predictions occur, or if > 95% of windows are healthy:
       Flight prediction is 'healthy'.
    2. Otherwise, filter for non-healthy predictions and return the plurality (mode)
       fault class, weighted by model confidence.

    Args:
        predicted_faults: Sequence of predicted fault class strings.
        confidences: Sequence of model confidence scores.
        anomalies: Sequence of anomaly boolean flags.

    Returns:
        Tuple[str, float]: (flight_level_fault_prediction, mean_fault_confidence)
    """
    if not predicted_faults:
        return "healthy", 1.0

    non_healthy = [
        (fault, conf) for fault, conf in zip(predicted_faults, confidences)
        if fault != "healthy"
    ]

    # If fewer than 5% of valid windows are non-healthy, classify as healthy
    if len(non_healthy) < max(3, 0.05 * len(predicted_faults)):
        healthy_confs = [conf for fault, conf in zip(predicted_faults, confidences) if fault == "healthy"]
        mean_conf = float(np.mean(healthy_confs)) if healthy_confs else 1.0
        return "healthy", mean_conf

    # Score each candidate fault by sum of confidences
    fault_scores: Dict[str, float] = Counter()
    fault_counts: Dict[str, int] = Counter()
    for fault, conf in non_healthy:
        fault_scores[fault] += conf
        fault_counts[fault] += 1

    top_fault = max(fault_scores.keys(), key=lambda k: fault_scores[k])
    top_confs = [conf for fault, conf in non_healthy if fault == top_fault]
    mean_conf = float(np.mean(top_confs)) if top_confs else 1.0

    return top_fault, mean_conf


def compute_flight_lead_time(
    df_flight: pd.DataFrame,
    predicted_faults: List[str],
    anomalies: List[bool],
    min_consecutive: int = 5,
) -> Optional[float]:
    """
    Calculate detection lead time (in seconds) before redline.

    Lead time = t_to_redline at the earliest point where the system makes
    a persistent fault or anomaly detection (at least min_consecutive windows).

    Args:
        df_flight: Flight DataFrame containing ground-truth 't_to_redline' and 't_s'.
        predicted_faults: Sequence of predicted fault strings.
        anomalies: Sequence of anomaly boolean flags.
        min_consecutive: Number of consecutive detections required for persistence (default 5).

    Returns:
        Optional[float]: Lead time in seconds, or None if no detection occurred.
    """
    if "t_to_redline" not in df_flight.columns:
        return None

    # Identify earliest persistent detection index
    detection_flags = [
        (fault != "healthy") or is_anom
        for fault, is_anom in zip(predicted_faults, anomalies)
    ]

    consecutive = 0
    earliest_idx = None

    # Account for 59 initial incomplete window offset
    offset = len(df_flight) - len(detection_flags)

    for i, flag in enumerate(detection_flags):
        if flag:
            consecutive += 1
            if consecutive >= min_consecutive and earliest_idx is None:
                earliest_idx = i - min_consecutive + 1 + offset
                break
        else:
            consecutive = 0

    if earliest_idx is None or earliest_idx >= len(df_flight):
        return None

    redline_val = df_flight["t_to_redline"].iloc[earliest_idx]
    if pd.notna(redline_val):
        try:
            val = float(redline_val)
            if val > 0:
                return val
        except (ValueError, TypeError):
            pass

    return None
