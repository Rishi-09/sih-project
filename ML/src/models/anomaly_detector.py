"""
Unsupervised Anomaly Detector Module for R2 ML.

Step 14: Model 3 — Unsupervised IsolationForest Anomaly Detector.
- Learns the nominal/healthy distribution of 60-second windowed z-score residuals.
- Trained STRICTLY on healthy training flight data (no faulty data used during fitting).
- Uses the 76 rolling window features (19 sensors * 4 features).
- Strictly isolated from raw sensor readings, predictions, residuals, and metadata.
- Provides boolean anomaly flags and continuous decision/anomaly scores.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from src.preprocessing.schema import SENSOR_COLS

FEATURES_PER_SENSOR: List[str] = ["mean", "std", "slope", "max_abs"]
DEFAULT_FEATURE_NAMES: List[str] = [
    f"window_{f}_z_{s}" for s in SENSOR_COLS for f in FEATURES_PER_SENSOR
]


class AnomalyDetector:
    """
    Unsupervised IsolationForest Anomaly Detector for 76-dimensional window features.
    """

    def __init__(
        self,
        model: Optional[Any] = None,
        feature_names: Optional[List[str]] = None,
        contamination: Union[str, float] = 0.01,
        threshold: float = 0.0,
        n_estimators: int = 150,
        random_state: int = 42,
    ):
        self.random_state = random_state
        self.contamination = contamination
        self.threshold = threshold
        self.n_estimators = n_estimators
        self.feature_names = feature_names or DEFAULT_FEATURE_NAMES
        self.model = model or IsolationForest(
            n_estimators=self.n_estimators,
            contamination=self.contamination,
            random_state=self.random_state,
            n_jobs=-1,
        )
        self.metadata: Dict[str, Any] = {}

    def _prepare_X(self, X: Union[pd.DataFrame, np.ndarray, Dict[str, Any], pd.Series]) -> np.ndarray:
        """Extract and order feature array strictly according to self.feature_names."""
        if isinstance(X, pd.DataFrame):
            missing = [f for f in self.feature_names if f not in X.columns]
            if missing:
                raise KeyError(f"Input DataFrame missing {len(missing)} required features: {missing[:5]}...")
            return X[self.feature_names].to_numpy(dtype=np.float64)
        elif isinstance(X, pd.Series):
            missing = [f for f in self.feature_names if f not in X.index]
            if missing:
                raise KeyError(f"Input Series missing {len(missing)} required features: {missing[:5]}...")
            return X[self.feature_names].to_numpy(dtype=np.float64).reshape(1, -1)
        elif isinstance(X, dict):
            missing = [f for f in self.feature_names if f not in X]
            if missing:
                raise KeyError(f"Input dict missing {len(missing)} required features: {missing[:5]}...")
            arr = np.array([X[f] for f in self.feature_names], dtype=np.float64)
            return arr.reshape(1, -1)
        elif isinstance(X, np.ndarray):
            if X.ndim == 1:
                if X.shape[0] != len(self.feature_names):
                    raise ValueError(f"Expected {len(self.feature_names)} features, got {X.shape[0]}.")
                return X.reshape(1, -1)
            elif X.ndim == 2:
                if X.shape[1] != len(self.feature_names):
                    raise ValueError(f"Expected {len(self.feature_names)} features, got {X.shape[1]}.")
                return X
            else:
                raise ValueError("X must be 1D or 2D array.")
        else:
            raise TypeError(f"Unsupported input type {type(X)} for features.")

    def fit(
        self,
        X_healthy: Union[pd.DataFrame, np.ndarray],
        training_metadata: Optional[Dict[str, Any]] = None,
    ) -> "AnomalyDetector":
        """
        Fit IsolationForest on healthy training window features only.
        """
        X_arr = self._prepare_X(X_healthy)

        # Drop any rows containing NaNs (e.g. incomplete initial windows)
        valid_mask = np.all(np.isfinite(X_arr), axis=1)
        X_clean = X_arr[valid_mask]

        if len(X_clean) == 0:
            raise ValueError("No valid healthy training samples remaining after removing NaNs.")

        self.model.fit(X_clean)

        # Base statistics on training data
        train_decision_scores = self.model.decision_function(X_clean)

        self.metadata = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model_type": type(self.model).__name__,
            "n_features": len(self.feature_names),
            "n_training_samples": len(X_clean),
            "contamination": self.contamination,
            "threshold": self.threshold,
            "n_estimators": self.n_estimators,
            "random_state": self.random_state,
            "training_decision_mean": float(np.mean(train_decision_scores)),
            "training_decision_std": float(np.std(train_decision_scores)),
            "training_decision_min": float(np.min(train_decision_scores)),
            "training_decision_max": float(np.max(train_decision_scores)),
        }
        if training_metadata:
            self.metadata.update(training_metadata)

        return self

    def decision_function(self, X: Union[pd.DataFrame, np.ndarray, Dict[str, Any], pd.Series]) -> np.ndarray:
        """
        Compute decision function score.
        Positive values indicate normal/inlier points; negative values indicate anomalies.
        """
        X_arr = self._prepare_X(X)
        return self.model.decision_function(X_arr)

    def predict(self, X: Union[pd.DataFrame, np.ndarray, Dict[str, Any], pd.Series]) -> np.ndarray:
        """
        Predict binary anomaly flag: True for anomaly, False for nominal.
        """
        dec = self.decision_function(X)
        return dec < self.threshold

    def detect_anomaly(
        self,
        window_features: Union[pd.DataFrame, pd.Series, Dict[str, Any], np.ndarray],
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """
        Inference interface: Evaluates anomaly flag and continuous scores.

        Score Interpretation:
        - decision_score: Standard scikit-learn decision function (> 0 is normal, < 0 is anomalous).
        - anomaly_score: Inverted score (-decision_score), where higher values indicate higher abnormality.
        - anomaly: Boolean flag (True if decision_score < threshold).

        Args:
            window_features: Single sample (dict, Series, 1D array) or batch (DataFrame, 2D array).

        Returns:
            Dict[str, Any] for single sample, or List[Dict[str, Any]] for batch:
            {
                "anomaly": bool,
                "anomaly_score": float,
                "decision_score": float,
                "threshold": float
            }
        """
        X_arr = self._prepare_X(window_features)
        dec_scores = self.model.decision_function(X_arr)
        is_anom = dec_scores < self.threshold
        anom_scores = -dec_scores

        results: List[Dict[str, Any]] = []
        for i in range(len(dec_scores)):
            results.append({
                "anomaly": bool(is_anom[i]),
                "anomaly_score": float(anom_scores[i]),
                "decision_score": float(dec_scores[i]),
                "threshold": float(self.threshold),
            })

        if isinstance(window_features, (dict, pd.Series)) or (isinstance(window_features, np.ndarray) and window_features.ndim == 1):
            return results[0]
        if isinstance(window_features, pd.DataFrame) and len(window_features) == 1:
            return results[0]

        return results

    def save(self, output_dir: Union[str, Path]) -> Path:
        """Save detector artifacts to destination directory."""
        dir_path = Path(output_dir)
        dir_path.mkdir(parents=True, exist_ok=True)

        # 1. Model binary
        model_path = dir_path / "anomaly_detector.joblib"
        joblib.dump(self.model, model_path)

        # 2. Feature list
        feat_path = dir_path / "feature_names.json"
        with open(feat_path, "w", encoding="utf-8") as f:
            json.dump({
                "n_features": len(self.feature_names),
                "feature_names": self.feature_names,
            }, f, indent=2)

        # 3. Metadata / Configuration
        meta_path = dir_path / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, indent=2)

        return dir_path

    @classmethod
    def load(cls, model_dir: Union[str, Path]) -> "AnomalyDetector":
        """Load trained AnomalyDetector from artifact directory."""
        dir_path = Path(model_dir)

        model_path = dir_path / "anomaly_detector.joblib"
        feat_path = dir_path / "feature_names.json"
        meta_path = dir_path / "metadata.json"

        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found at {model_path}")

        model = joblib.load(model_path)

        with open(feat_path, "r", encoding="utf-8") as f:
            feat_data = json.load(f)
            feature_names = feat_data["feature_names"]

        metadata = {}
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

        instance = cls(
            model=model,
            feature_names=feature_names,
            contamination=metadata.get("contamination", 0.01),
            threshold=metadata.get("threshold", 0.0),
            n_estimators=metadata.get("n_estimators", 150),
            random_state=metadata.get("random_state", 42),
        )
        instance.metadata = metadata
        return instance
