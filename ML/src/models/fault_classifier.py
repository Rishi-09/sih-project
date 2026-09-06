"""
Fault Classifier Model Module for R2 ML.

Step 13: Model 2 — Multiclass Fault Classifier.
- Classifies fault types using the 76 windowed residual/z-score features from 60-second windows.
- Preserves all simulator fault labels (including 'healthy').
- Provides predicted fault type, confidence (class probability), and full probability distribution.
- Strictly isolated from raw sensor readings, predictions, and metadata labels to prevent data leakage.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from src.preprocessing.schema import SENSOR_COLS

FEATURES_PER_SENSOR: List[str] = ["mean", "std", "slope", "max_abs"]
DEFAULT_FEATURE_NAMES: List[str] = [
    f"window_{f}_z_{s}" for s in SENSOR_COLS for f in FEATURES_PER_SENSOR
]


class FaultClassifier:
    """
    Multiclass Fault Classifier using 76 rolling window residual features.
    """

    def __init__(
        self,
        classifier: Optional[Any] = None,
        feature_names: Optional[List[str]] = None,
        classes: Optional[List[str]] = None,
        random_state: int = 42,
    ):
        self.random_state = random_state
        self.feature_names = feature_names or DEFAULT_FEATURE_NAMES
        self.classes_: Optional[np.ndarray] = np.array(classes) if classes is not None else None
        self.classifier = classifier or HistGradientBoostingClassifier(
            loss="log_loss",
            learning_rate=0.1,
            max_iter=150,
            max_leaf_nodes=31,
            min_samples_leaf=20,
            class_weight="balanced",
            random_state=self.random_state,
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
        X: Union[pd.DataFrame, np.ndarray],
        y: Union[pd.Series, np.ndarray],
        training_metadata: Optional[Dict[str, Any]] = None,
    ) -> "FaultClassifier":
        """
        Train the multiclass fault classifier on training window features.
        """
        X_arr = self._prepare_X(X)
        y_arr = np.asarray(y)

        # Drop any rows where features contain NaN (e.g. incomplete initial windows)
        valid_mask = np.all(np.isfinite(X_arr), axis=1) & pd.notna(y_arr)
        X_clean = X_arr[valid_mask]
        y_clean = y_arr[valid_mask]

        if len(X_clean) == 0:
            raise ValueError("No valid training samples remaining after removing NaNs.")

        self.classifier.fit(X_clean, y_clean)
        self.classes_ = np.array(self.classifier.classes_)

        # Class counts
        unique_classes, counts = np.unique(y_clean, return_counts=True)
        class_dist = {str(cls): int(cnt) for cls, cnt in zip(unique_classes, counts)}

        self.metadata = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model_type": type(self.classifier).__name__,
            "n_features": len(self.feature_names),
            "n_classes": len(self.classes_),
            "classes": [str(c) for c in self.classes_],
            "n_training_samples": len(X_clean),
            "training_class_distribution": class_dist,
            "random_state": self.random_state,
        }
        if training_metadata:
            self.metadata.update(training_metadata)

        return self

    def predict(self, X: Union[pd.DataFrame, np.ndarray, Dict[str, Any], pd.Series]) -> np.ndarray:
        """Predict fault class labels for input samples."""
        X_arr = self._prepare_X(X)
        return self.classifier.predict(X_arr)

    def predict_proba(self, X: Union[pd.DataFrame, np.ndarray, Dict[str, Any], pd.Series]) -> np.ndarray:
        """Predict class probabilities for input samples."""
        X_arr = self._prepare_X(X)
        return self.classifier.predict_proba(X_arr)

    def predict_fault(
        self,
        window_features: Union[pd.DataFrame, pd.Series, Dict[str, Any], np.ndarray],
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """
        Inference interface: Predicts fault_type, confidence, and full probability breakdown.

        Args:
            window_features: Single sample (dict, Series, 1D array) or batch (DataFrame, 2D array).

        Returns:
            Dict[str, Any] for single sample, or List[Dict[str, Any]] for batch:
            {
                "fault_type": str,
                "confidence": float (0.0 to 1.0),
                "probabilities": Dict[str, float]
            }
        """
        X_arr = self._prepare_X(window_features)
        probs = self.classifier.predict_proba(X_arr)
        preds = self.classifier.predict(X_arr)

        results: List[Dict[str, Any]] = []
        for i in range(len(preds)):
            pred_class = str(preds[i])
            pred_idx = np.where(self.classes_ == pred_class)[0][0]
            confidence = float(probs[i, pred_idx])
            prob_dict = {str(cls): float(probs[i, j]) for j, cls in enumerate(self.classes_)}

            results.append({
                "fault_type": pred_class,
                "confidence": confidence,
                "probabilities": prob_dict,
            })

        # Return single dict if input was single sample
        if isinstance(window_features, (dict, pd.Series)) or (isinstance(window_features, np.ndarray) and window_features.ndim == 1):
            return results[0]
        if isinstance(window_features, pd.DataFrame) and len(window_features) == 1:
            return results[0]

        return results

    def save(self, output_dir: Union[str, Path]) -> Path:
        """Save model artifacts to target directory."""
        dir_path = Path(output_dir)
        dir_path.mkdir(parents=True, exist_ok=True)

        # 1. Model binary
        model_path = dir_path / "fault_classifier.joblib"
        joblib.dump(self.classifier, model_path)

        # 2. Feature list
        feat_path = dir_path / "feature_names.json"
        with open(feat_path, "w", encoding="utf-8") as f:
            json.dump({
                "n_features": len(self.feature_names),
                "feature_names": self.feature_names,
            }, f, indent=2)

        # 3. Class labels
        classes_path = dir_path / "class_labels.json"
        with open(classes_path, "w", encoding="utf-8") as f:
            json.dump({
                "n_classes": len(self.classes_) if self.classes_ is not None else 0,
                "classes": [str(c) for c in self.classes_] if self.classes_ is not None else [],
            }, f, indent=2)

        # 4. Metadata
        meta_path = dir_path / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, indent=2)

        return dir_path

    @classmethod
    def load(cls, model_dir: Union[str, Path]) -> "FaultClassifier":
        """Load trained FaultClassifier from artifact directory."""
        dir_path = Path(model_dir)

        model_path = dir_path / "fault_classifier.joblib"
        feat_path = dir_path / "feature_names.json"
        classes_path = dir_path / "class_labels.json"
        meta_path = dir_path / "metadata.json"

        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found at {model_path}")

        classifier = joblib.load(model_path)

        with open(feat_path, "r", encoding="utf-8") as f:
            feat_data = json.load(f)
            feature_names = feat_data["feature_names"]

        with open(classes_path, "r", encoding="utf-8") as f:
            class_data = json.load(f)
            classes = class_data["classes"]

        metadata = {}
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

        instance = cls(
            classifier=classifier,
            feature_names=feature_names,
            classes=classes,
            random_state=metadata.get("random_state", 42),
        )
        instance.metadata = metadata
        return instance
