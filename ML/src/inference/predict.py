"""
End-to-End Inference Module for R2 ML.

Step 16: Final ML Pipeline Integration.
Combines all engine health monitoring components into a single unified inference pipeline:
1. Validates required context (5) and sensor (19) fields.
2. Model 1 (Nominal Digital Twin): Predicts expected nominal sensor telemetry.
3. Residuals & Healthy-Baseline Z-scores: Calculates directional z-scores.
4. Feature Extraction: Computes 76-dimensional 60-second rolling window features.
5. Health Index: Computes 0-100 rule-based health scores and dynamic explanations.
6. Model 2 (Fault Classifier): Predicts fault type and confidence.
7. Model 3 (Anomaly Detector): Detects anomaly flag and continuous anomaly score.
8. Prognosis / RUL: Extrapolates health trend to failure threshold.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd

from src.models.nominal_twin import NominalDigitalTwin
from src.models.fault_classifier import FaultClassifier, DEFAULT_FEATURE_NAMES
from src.models.anomaly_detector import AnomalyDetector
from src.features.residual_features import compute_residuals, compute_z_scores
from src.features.window_features import (
    compute_sensor_window_features,
    WINDOW_SECONDS,
    SAMPLES_PER_WINDOW,
)
from src.health_index.health_index import (
    compute_sensor_health_score,
    compute_subsystem_health_scores,
    compute_overall_health_score,
    generate_subsystem_explanation,
    generate_overall_explanation,
    SUBSYSTEM_MAP,
    SUBSYSTEM_NAMES,
)
from src.prognosis.rul import (
    estimate_rul,
    DEFAULT_RUL_TREND_WINDOW_SECONDS,
    DEFAULT_FAILURE_HEALTH_THRESHOLD,
)
from src.preprocessing.schema import CONTEXT_COLS, SENSOR_COLS


class InferencePipeline:
    """
    Unified end-to-end inference pipeline for R2 engine telemetry.
    """

    def __init__(
        self,
        nominal_twin_dir: Union[str, Path] = "models/nominal_twin",
        healthy_stats_path: Union[str, Path] = "data/processed/residuals/healthy_residual_stats.json",
        fault_classifier_dir: Union[str, Path] = "models/fault_classifier",
        anomaly_detector_dir: Union[str, Path] = "models/anomaly_detector",
        window_size: int = SAMPLES_PER_WINDOW,
        trend_window_seconds: int = DEFAULT_RUL_TREND_WINDOW_SECONDS,
        failure_threshold: float = DEFAULT_FAILURE_HEALTH_THRESHOLD,
    ):
        self.window_size = window_size
        self.trend_window_seconds = trend_window_seconds
        self.failure_threshold = failure_threshold

        # 1. Load Model 1 (Nominal Digital Twin)
        self.nominal_twin = NominalDigitalTwin.load(nominal_twin_dir)

        # 2. Load Healthy Residual Statistics
        stats_path = Path(healthy_stats_path)
        if not stats_path.exists():
            raise FileNotFoundError(f"Healthy residual stats not found at {stats_path}")
        with open(stats_path, "r", encoding="utf-8") as f:
            stats_data = json.load(f)
            self.healthy_stats = stats_data.get("sensor_stats", stats_data)

        # 3. Load Model 2 (Fault Classifier)
        self.fault_classifier = FaultClassifier.load(fault_classifier_dir)

        # 4. Load Model 3 (Anomaly Detector)
        self.anomaly_detector = AnomalyDetector.load(anomaly_detector_dir)

        self.feature_names = DEFAULT_FEATURE_NAMES

    def validate_input(self, telemetry_df: pd.DataFrame) -> None:
        """Validate that input telemetry contains all required context and sensor columns."""
        if not isinstance(telemetry_df, pd.DataFrame):
            raise TypeError(f"Expected pandas DataFrame, got {type(telemetry_df)}")

        missing_context = [c for c in CONTEXT_COLS if c not in telemetry_df.columns]
        if missing_context:
            raise ValueError(f"Missing required context columns: {missing_context}")

        missing_sensors = [s for s in SENSOR_COLS if s not in telemetry_df.columns]
        if missing_sensors:
            raise ValueError(f"Missing required sensor columns: {missing_sensors}")

        if len(telemetry_df) < self.window_size:
            raise ValueError(
                f"Telemetry input has {len(telemetry_df)} rows; a full 60-second window "
                f"requires at least {self.window_size} rows."
            )

        # Validate that the telemetry window does not contain missing (NaN) values in required columns
        req_cols = [c for c in CONTEXT_COLS if c != "phase"] + SENSOR_COLS
        nan_counts = telemetry_df[req_cols].isna().sum()
        cols_with_nan = nan_counts[nan_counts > 0].index.tolist()
        if cols_with_nan:
            raise ValueError(
                f"Telemetry window contains NaN/null values in required columns: {cols_with_nan}. "
                f"Clean numerical telemetry is required for inference."
            )

    def extract_window_features(
        self,
        telemetry_df: pd.DataFrame,
    ) -> Tuple[pd.DataFrame, Dict[str, float]]:
        """
        Run Model 1, compute residuals, z-scores, and extract 76-dimensional window features.
        Returns full window dataframe and latest single 76D feature dictionary.
        """
        # Predict expected nominal sensor values
        pred_df = self.nominal_twin.predict(telemetry_df[CONTEXT_COLS])

        # Compute raw residuals
        res_df = compute_residuals(telemetry_df, pred_df, sensor_cols=SENSOR_COLS)

        # Compute z-scores
        z_df = compute_z_scores(res_df, self.healthy_stats, sensor_cols=SENSOR_COLS)

        # Extract 76 rolling window features over the telemetry sequence
        feature_dict_latest: Dict[str, float] = {}
        window_features_rows: Dict[str, np.ndarray] = {}

        for sensor in SENSOR_COLS:
            z_col = f"z_score_{sensor}"
            z_series = z_df[z_col]

            sensor_feats = compute_sensor_window_features(
                z_series,
                sensor_name=sensor,
                window_size=self.window_size,
            )
            for feat_name, arr in sensor_feats.items():
                window_features_rows[feat_name] = arr
                feature_dict_latest[feat_name] = float(arr[-1])

        features_df = pd.DataFrame(window_features_rows, index=telemetry_df.index)
        return features_df, feature_dict_latest

    def predict(
        self,
        telemetry_window: pd.DataFrame,
        health_history: Optional[Union[pd.Series, np.ndarray, List[float]]] = None,
        timestamps: Optional[Union[pd.Series, np.ndarray, List[float]]] = None,
    ) -> Dict[str, Any]:
        """
        Execute end-to-end engine diagnostic prediction on incoming telemetry window.

        Args:
            telemetry_window: DataFrame containing at least 60 rows of telemetry with CONTEXT_COLS and SENSOR_COLS.
            health_history: Optional sequence of prior health scores for RUL extrapolation.
            timestamps: Optional timestamps corresponding to health_history.

        Returns:
            Dict[str, Any] conforming to the unified system interface:
            {
                "health_score": float,
                "subsystem_scores": Dict[str, float],
                "fault_type": str,
                "confidence": float,
                "anomaly": bool,
                "anomaly_score": float,
                "remaining_useful_life": Optional[float],
                "explanations": {
                    "health_overall": str,
                    "subsystems": Dict[str, str],
                    "rul": str
                },
                "probabilities": Dict[str, float]
            }
        """
        # 1. Validate input schema & length
        self.validate_input(telemetry_window)

        # 2. Extract 76-dimensional window features
        features_df, latest_features = self.extract_window_features(telemetry_window)

        # 3. Compute Sensor Health Scores (Latest Timestep)
        sensor_health: Dict[str, np.ndarray] = {}
        for s in SENSOR_COLS:
            mean_z = latest_features[f"window_mean_z_{s}"]
            max_abs_z = latest_features[f"window_max_abs_z_{s}"]
            std_z = latest_features[f"window_std_z_{s}"]
            slope_z = latest_features[f"window_slope_z_{s}"]

            s_score = compute_sensor_health_score(mean_z, max_abs_z, std_z, slope_z)
            sensor_health[s] = np.array([s_score])

        # 4. Compute Subsystem Health Scores
        subsystem_scores_arr = compute_subsystem_health_scores(sensor_health, subsystem_map=SUBSYSTEM_MAP)
        subsystem_scores = {sub: float(subsystem_scores_arr[sub][0]) for sub in SUBSYSTEM_NAMES}

        # 5. Compute Overall Engine Health Score
        overall_health_arr = compute_overall_health_score(subsystem_scores_arr)
        overall_health = float(overall_health_arr[0])

        # 6. Generate Dynamic Health Explanations
        subsystem_explanations: Dict[str, str] = {}
        for sub, sensors in SUBSYSTEM_MAP.items():
            subsystem_explanations[sub] = generate_subsystem_explanation(
                subsystem_name=sub,
                subsystem_score=subsystem_scores[sub],
                sensors_in_subsystem=sensors,
                window_features_row=latest_features,
            )

        overall_explanation = generate_overall_explanation(
            overall_score=overall_health,
            subsystem_scores=subsystem_scores,
            subsystem_explanations=subsystem_explanations,
        )

        # 7. Model 2: Fault Classification
        fault_res = self.fault_classifier.predict_fault(latest_features)

        # 8. Model 3: Unsupervised Anomaly Detection
        anom_res = self.anomaly_detector.detect_anomaly(latest_features)

        # 9. Prognosis / Remaining Useful Life (RUL)
        # If external health history is provided, use it; otherwise compute sequence from telemetry window
        if health_history is not None:
            rul_res = estimate_rul(
                health_history=health_history,
                timestamps=timestamps,
                trend_window_seconds=self.trend_window_seconds,
                failure_threshold=self.failure_threshold,
            )
        else:
            # Build health sequence across the window if length >= 60
            valid_feats_df = features_df.dropna()
            if len(valid_feats_df) >= 30:
                seq_h = []
                for idx in range(len(valid_feats_df)):
                    row_feat = valid_feats_df.iloc[idx].to_dict()
                    s_dict = {
                        s: np.array([compute_sensor_health_score(
                            row_feat[f"window_mean_z_{s}"],
                            row_feat[f"window_max_abs_z_{s}"],
                            row_feat[f"window_std_z_{s}"],
                            row_feat[f"window_slope_z_{s}"],
                        )]) for s in SENSOR_COLS
                    }
                    sub_h = compute_subsystem_health_scores(s_dict, subsystem_map=SUBSYSTEM_MAP)
                    seq_h.append(float(compute_overall_health_score(sub_h)[0]))

                t_seq = telemetry_window.loc[valid_feats_df.index, "t_s"].to_numpy() if "t_s" in telemetry_window.columns else np.arange(len(seq_h))
                rul_res = estimate_rul(
                    health_history=seq_h,
                    timestamps=t_seq,
                    trend_window_seconds=self.trend_window_seconds,
                    failure_threshold=self.failure_threshold,
                )
            else:
                rul_res = {
                    "remaining_useful_life": None,
                    "trend_slope": None,
                    "explanation": "Insufficient health history for RUL estimation (< 30 valid windows).",
                }

        # 10. Assemble Consolidated Output Interface
        return {
            "health_score": overall_health,
            "subsystem_scores": subsystem_scores,
            "fault_type": fault_res["fault_type"],
            "confidence": fault_res["confidence"],
            "anomaly": anom_res["anomaly"],
            "anomaly_score": anom_res["anomaly_score"],
            "decision_score": anom_res["decision_score"],
            "remaining_useful_life": rul_res["remaining_useful_life"],
            "explanations": {
                "health_overall": overall_explanation,
                "subsystems": subsystem_explanations,
                "rul": rul_res["explanation"],
            },
            "probabilities": fault_res["probabilities"],
        }


# Global singleton pipeline instance for direct predict() calls
_GLOBAL_PIPELINE: Optional[InferencePipeline] = None


def get_inference_pipeline() -> InferencePipeline:
    """Retrieve or initialize the global InferencePipeline singleton."""
    global _GLOBAL_PIPELINE
    if _GLOBAL_PIPELINE is None:
        _GLOBAL_PIPELINE = InferencePipeline()
    return _GLOBAL_PIPELINE


def predict(
    telemetry_window: pd.DataFrame,
    health_history: Optional[Union[pd.Series, np.ndarray, List[float]]] = None,
    timestamps: Optional[Union[pd.Series, np.ndarray, List[float]]] = None,
) -> Dict[str, Any]:
    """
    Final public backend-ready predict function.

    Takes a 60-second window of sensors and context telemetry and returns
    health score, subsystem scores, fault classification, anomaly status, and RUL.

    Args:
        telemetry_window: DataFrame with at least 60 rows containing CONTEXT_COLS and SENSOR_COLS.
        health_history: Optional array of historical health scores for RUL extrapolation.
        timestamps: Optional timestamps for health history.

    Returns:
        Dict[str, Any]: Complete diagnostic payload.
    """
    pipeline = get_inference_pipeline()
    return pipeline.predict(
        telemetry_window=telemetry_window,
        health_history=health_history,
        timestamps=timestamps,
    )
