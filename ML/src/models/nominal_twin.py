"""
Nominal Digital Twin Model Module for R2 ML.

Step 9: Model 1 Nominal Digital Twin.
- Uses 5 context variables as inputs:
    - throttle_pct
    - alt_m
    - oat_c
    - ias_kt
    - phase (one-hot encoded)
- Predicts all 19 engine sensor channels.
- Trained ONLY on healthy rows from training flight runs.
- Trains one HistGradientBoostingRegressor per target sensor.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from sklearn.preprocessing import OneHotEncoder

from src.preprocessing.schema import CONTEXT_COLS, SENSOR_COLS, validate_context_cols


NUMERICAL_CONTEXT_COLS: List[str] = [
    "throttle_pct",
    "alt_m",
    "oat_c",
    "ias_kt",
]
CATEGORICAL_CONTEXT_COLS: List[str] = ["phase"]


class NominalDigitalTwin:
    """
    Nominal Digital Twin Model predicting nominal baseline engine sensor values.
    
    Contains 19 individual HistGradientBoostingRegressor models (one for each sensor channel)
    and a OneHotEncoder for the categorical 'phase' input feature.
    """

    def __init__(
        self,
        random_state: int = 42,
        model_kwargs: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Initialize the Nominal Digital Twin.

        Args:
            random_state: Random state for reproducibility.
            model_kwargs: Optional dictionary of keyword arguments passed to HistGradientBoostingRegressor.
        """
        self.random_state = random_state
        self.model_kwargs = model_kwargs or {}
        self.input_cols = list(CONTEXT_COLS)
        self.numerical_cols = list(NUMERICAL_CONTEXT_COLS)
        self.categorical_cols = list(CATEGORICAL_CONTEXT_COLS)
        self.target_cols = list(SENSOR_COLS)

        self.encoder: OneHotEncoder = OneHotEncoder(
            handle_unknown="ignore",
            sparse_output=False,
        )
        self.models: Dict[str, HistGradientBoostingRegressor] = {}
        self.feature_names_out_: Optional[List[str]] = None
        self.is_fitted: bool = False

    def _prepare_features(
        self,
        df: pd.DataFrame,
        fit_encoder: bool = False,
    ) -> np.ndarray:
        """
        Extract numerical features and one-hot encode categorical features.

        Args:
            df: Input DataFrame containing context columns.
            fit_encoder: Whether to fit the encoder on df['phase'].

        Returns:
            np.ndarray: Concatenated feature array [numerical_features, encoded_phase].
        """
        validate_context_cols(df)

        num_features = df[self.numerical_cols].to_numpy(dtype=np.float64)
        cat_df = df[self.categorical_cols].astype(str)

        if fit_encoder:
            cat_features = self.encoder.fit_transform(cat_df)
            encoded_phase_names = [
                f"phase_{c}" for c in self.encoder.categories_[0]
            ]
            self.feature_names_out_ = self.numerical_cols + encoded_phase_names
        else:
            if not hasattr(self.encoder, "categories_"):
                raise ValueError("Encoder must be fitted before transforming features.")
            cat_features = self.encoder.transform(cat_df)

        return np.hstack([num_features, cat_features])

    def fit(
        self,
        train_df: pd.DataFrame,
        enforce_healthy_only: bool = True,
    ) -> "NominalDigitalTwin":
        """
        Fit one HistGradientBoostingRegressor per target sensor on healthy training telemetry.

        Args:
            train_df: DataFrame containing context input columns and all 19 sensor target columns.
            enforce_healthy_only: If True, checks that all rows have fault_label == 'healthy'.

        Returns:
            self: The fitted NominalDigitalTwin instance.
        """
        if enforce_healthy_only and "fault_label" in train_df.columns:
            unhealthy_mask = train_df["fault_label"] != "healthy"
            unhealthy_count = int(unhealthy_mask.sum())
            if unhealthy_count > 0:
                raise ValueError(
                    f"Model 1 must be trained ONLY on healthy rows. "
                    f"Found {unhealthy_count} non-healthy rows in training data."
                )

        # Prepare X features and fit encoder
        x_train = self._prepare_features(train_df, fit_encoder=True)

        # Train one regressor per target sensor
        self.models = {}
        for sensor in self.target_cols:
            if sensor not in train_df.columns:
                raise KeyError(f"Target sensor column '{sensor}' not found in training DataFrame.")

            y_train = train_df[sensor].to_numpy(dtype=np.float64)

            regressor = HistGradientBoostingRegressor(
                random_state=self.random_state,
                **self.model_kwargs,
            )
            regressor.fit(x_train, y_train)
            self.models[sensor] = regressor

        self.is_fitted = True
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Predict nominal sensor values for all 19 channels given context inputs.

        Args:
            df: DataFrame containing the 5 context input columns.

        Returns:
            pd.DataFrame: DataFrame containing predicted values for all 19 sensor columns,
                          indexed identically to input df.
        """
        if not self.is_fitted:
            raise RuntimeError("NominalDigitalTwin must be fitted before calling predict.")

        x_features = self._prepare_features(df, fit_encoder=False)
        predictions = {}

        for sensor in self.target_cols:
            predictions[sensor] = self.models[sensor].predict(x_features)

        return pd.DataFrame(predictions, index=df.index)

    def evaluate(
        self,
        test_df: pd.DataFrame,
    ) -> Dict[str, Dict[str, float]]:
        """
        Evaluate predictions against ground-truth sensor columns on a test DataFrame.

        Args:
            test_df: DataFrame containing context input columns and ground-truth sensor columns.

        Returns:
            Dict[str, Dict[str, float]]: Dictionary mapping each sensor to {'mae': float, 'rmse': float}.
        """
        if not self.is_fitted:
            raise RuntimeError("NominalDigitalTwin must be fitted before calling evaluate.")

        preds_df = self.predict(test_df)
        metrics: Dict[str, Dict[str, float]] = {}

        for sensor in self.target_cols:
            if sensor not in test_df.columns:
                raise KeyError(f"Ground truth column '{sensor}' not found in test DataFrame.")

            y_true = test_df[sensor].to_numpy(dtype=np.float64)
            y_pred = preds_df[sensor].to_numpy(dtype=np.float64)

            mae = float(mean_absolute_error(y_true, y_pred))
            rmse = float(root_mean_squared_error(y_true, y_pred))

            metrics[sensor] = {
                "mae": mae,
                "rmse": rmse,
            }

        return metrics

    def save(
        self,
        save_dir: Union[str, Path],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Save the fitted twin models, phase encoder, and metadata.

        Args:
            save_dir: Directory path where artifacts will be saved (e.g. models/nominal_twin/).
            metadata: Optional additional metadata dictionary to store in metadata.json.
        """
        if not self.is_fitted:
            raise RuntimeError("Cannot save unfitted NominalDigitalTwin.")

        out_dir = Path(save_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        # 1. Save individual sensor models
        for sensor, model in self.models.items():
            model_path = out_dir / f"model_{sensor}.joblib"
            joblib.dump(model, model_path)

        # 2. Save complete bundle
        bundle_path = out_dir / "nominal_twin_bundle.joblib"
        joblib.dump(
            {
                "models": self.models,
                "encoder": self.encoder,
                "random_state": self.random_state,
                "model_kwargs": self.model_kwargs,
                "input_cols": self.input_cols,
                "numerical_cols": self.numerical_cols,
                "categorical_cols": self.categorical_cols,
                "target_cols": self.target_cols,
                "feature_names_out": self.feature_names_out_,
            },
            bundle_path,
        )

        # 3. Save phase encoder / preprocessing information
        encoder_path = out_dir / "phase_encoder.joblib"
        joblib.dump(self.encoder, encoder_path)

        # 4. Save metadata JSON
        meta_dict: Dict[str, Any] = {
            "model_type": "HistGradientBoostingRegressor",
            "model_name": "Model 1 Nominal Digital Twin",
            "input_columns": self.input_cols,
            "target_columns": self.target_cols,
            "random_state": self.random_state,
            "basic_training_config": {
                "model_class": "sklearn.ensemble.HistGradientBoostingRegressor",
                "random_state": self.random_state,
                **self.model_kwargs,
            },
            "phase_encoder": {
                "type": "OneHotEncoder",
                "categories": [list(self.encoder.categories_[0])],
                "handle_unknown": "ignore",
            },
            "training_date_time": datetime.now(timezone.utc).isoformat(),
        }

        if metadata:
            meta_dict.update(metadata)

        meta_path = out_dir / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta_dict, f, indent=2)

    @classmethod
    def load(cls, save_dir: Union[str, Path]) -> "NominalDigitalTwin":
        """
        Load a saved NominalDigitalTwin from the specified directory.

        Args:
            save_dir: Directory containing the saved model artifacts.

        Returns:
            NominalDigitalTwin: Reconstructed, ready-to-predict instance.
        """
        in_dir = Path(save_dir)
        bundle_path = in_dir / "nominal_twin_bundle.joblib"

        if bundle_path.is_file():
            bundle = joblib.load(bundle_path)
            instance = cls(
                random_state=bundle.get("random_state", 42),
                model_kwargs=bundle.get("model_kwargs", {}),
            )
            instance.models = bundle["models"]
            instance.encoder = bundle["encoder"]
            instance.input_cols = bundle.get("input_cols", list(CONTEXT_COLS))
            instance.numerical_cols = bundle.get("numerical_cols", list(NUMERICAL_CONTEXT_COLS))
            instance.categorical_cols = bundle.get("categorical_cols", list(CATEGORICAL_CONTEXT_COLS))
            instance.target_cols = bundle.get("target_cols", list(SENSOR_COLS))
            instance.feature_names_out_ = bundle.get("feature_names_out", None)
            instance.is_fitted = True
            return instance

        # Fallback to individual sensor model files
        encoder_path = in_dir / "phase_encoder.joblib"
        if not encoder_path.is_file():
            raise FileNotFoundError(f"Missing phase encoder file at: {encoder_path}")

        instance = cls()
        instance.encoder = joblib.load(encoder_path)
        instance.models = {}

        for sensor in SENSOR_COLS:
            model_path = in_dir / f"model_{sensor}.joblib"
            if not model_path.is_file():
                raise FileNotFoundError(f"Missing sensor model file: {model_path}")
            instance.models[sensor] = joblib.load(model_path)

        instance.is_fitted = True
        return instance
