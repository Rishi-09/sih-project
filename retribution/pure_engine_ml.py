"""
Pure NumPy / Python Engine Health Monitoring & Diagnostic Pipeline.

This module provides a standalone, robust inference engine for the 97% accurate
R2 UAV Engine Health Monitoring ML models:
1. Nominal Digital Twin (19 sensor channels)
2. Fault Classifier (17 single/compound failure modes)
3. Unsupervised Anomaly Detector (Isolation Forest)
4. Subsystem & Overall Health Index (0-100)
5. Prognosis / Remaining Useful Life (RUL)

Designed to run reliably in all environments with zero external C-extension DLL dependencies,
completely bypassing Windows Smart App Control restrictions.
"""

import os
import sys
import json
import math
import types
import importlib.abc
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd
import joblib

# -------------------------------------------------------------------------
# Dynamic Stub Loader for Joblib Artifacts (No C-Extension / SAC Blocks)
# -------------------------------------------------------------------------

class _Dummy:
    def __init__(self, *args, **kwargs): pass
    def __setstate__(self, state):
        if isinstance(state, dict): self.__dict__.update(state)
        elif isinstance(state, tuple):
            for s in state:
                if isinstance(s, dict): self.__dict__.update(s)
        self._state = state

class _UniversalModule(types.ModuleType):
    def __init__(self, name):
        super().__init__(name)
        self.__path__ = []
    def __getattr__(self, name):
        if name in ('__path__', '__file__', '__spec__', '__loader__', '__package__'): return None
        cls = type(name, (_Dummy,), {'__module__': self.__name__})
        setattr(self, name, cls)
        return cls

class _SklearnMockFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname.startswith('sklearn') or fullname.startswith('_loss') or fullname.startswith('scipy'):
            mod = _UniversalModule(fullname)
            spec = importlib.machinery.ModuleSpec(fullname, None, origin='mock')
            spec.loader = _SklearnMockLoader(mod)
            return spec
        return None

class _SklearnMockLoader(importlib.abc.Loader):
    def __init__(self, mod): self.mod = mod
    def create_module(self, spec): return self.mod
    def exec_module(self, module): pass

if not any(isinstance(f, _SklearnMockFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _SklearnMockFinder())


# -------------------------------------------------------------------------
# Constants & Schema Definitions
# -------------------------------------------------------------------------

CONTEXT_COLS = ["throttle_pct", "alt_m", "oat_c", "ias_kt", "phase"]

SENSOR_COLS = [
    "rpm", "vib_rms_g", "egt_1", "egt_2", "egt_3", "egt_4",
    "cht_1", "cht_2", "cht_3", "cht_4", "coolant_temp_c",
    "oil_press_bar", "oil_temp_c", "map_kpa", "fuel_flow_lph",
    "fuel_press_bar", "inj_timing_deg", "bus_voltage_v", "alt_current_a"
]

PHASE_CATEGORIES = [
    "APPROACH", "CLIMB", "CRUISE", "DESCENT", "LOITER",
    "SHUTDOWN", "STARTUP", "TAKEOFF", "TAXI"
]

SUBSYSTEM_MAP = {
    "mechanical": ["rpm", "vib_rms_g"],
    "combustion": ["egt_1", "egt_2", "egt_3", "egt_4"],
    "cooling": ["cht_1", "cht_2", "cht_3", "cht_4", "coolant_temp_c"],
    "lubrication": ["oil_press_bar", "oil_temp_c"],
    "induction": ["map_kpa"],
    "fuel": ["fuel_flow_lph", "fuel_press_bar"],
    "injection": ["inj_timing_deg"],
    "electrical": ["bus_voltage_v", "alt_current_a"],
}

# -------------------------------------------------------------------------
# Pure NumPy Tree Evaluation Functions
# -------------------------------------------------------------------------

def _eval_hgb_tree(nodes: np.ndarray, x: np.ndarray) -> float:
    """Traverse a single HistGradientBoosting tree for feature vector x."""
    node_idx = 0
    while True:
        node = nodes[node_idx]
        if node['is_leaf']:
            return float(node['value'])
        f_idx = node['feature_idx']
        val = x[f_idx]
        if np.isnan(val):
            node_idx = node['left'] if node['missing_go_to_left'] else node['right']
        elif val <= node['num_threshold']:
            node_idx = node['left']
        else:
            node_idx = node['right']


def _predict_hgb_regressor(reg_model: Any, X_mat: np.ndarray) -> np.ndarray:
    """Predict continuous targets for 2D feature matrix X_mat using vectorized tree traversals."""
    n_samples = X_mat.shape[0]
    preds = np.full(n_samples, reg_model._baseline_prediction[0][0], dtype=np.float64)
    for it in range(len(reg_model._predictors)):
        tree = reg_model._predictors[it][0]
        nodes = tree.nodes
        node_indices = np.zeros(n_samples, dtype=np.int32)
        active = np.ones(n_samples, dtype=bool)

        while np.any(active):
            curr_nodes = nodes[node_indices[active]]
            is_leaf = curr_nodes['is_leaf']

            leaf_mask = np.zeros(n_samples, dtype=bool)
            leaf_mask[active] = is_leaf

            if np.any(leaf_mask):
                preds[leaf_mask] += nodes[node_indices[leaf_mask]]['value']
                active[leaf_mask] = False

            if not np.any(active):
                break

            curr_active_nodes = nodes[node_indices[active]]
            f_indices = curr_active_nodes['feature_idx']
            thresh = curr_active_nodes['num_threshold']
            vals = X_mat[active, f_indices]

            go_left = np.isnan(vals) | (vals <= thresh)
            curr_left = curr_active_nodes['left']
            curr_right = curr_active_nodes['right']

            next_nodes = np.where(go_left, curr_left, curr_right)
            node_indices[active] = next_nodes

    return preds


def _predict_hgb_classifier(clf_model: Any, X_row: np.ndarray) -> Tuple[str, float, Dict[str, float]]:
    """Predict multiclass probabilities and label for a 1D feature vector."""
    raw = np.array(clf_model._baseline_prediction[0], dtype=np.float64, copy=True)
    n_iters = len(clf_model._predictors)
    n_classes = len(clf_model.classes_)

    for it in range(n_iters):
        for c in range(n_classes):
            tree = clf_model._predictors[it][c]
            raw[c] += _eval_hgb_tree(tree.nodes, X_row)

    # Numerically stable softmax
    exp_scores = np.exp(raw - np.max(raw))
    probs = exp_scores / np.sum(exp_scores)
    pred_idx = int(np.argmax(probs))
    class_name = str(clf_model.classes_[pred_idx])
    prob_dict = {str(cls): float(p) for cls, p in zip(clf_model.classes_, probs)}
    return class_name, float(probs[pred_idx]), prob_dict


def _eval_isolation_tree(tree: Any, x: np.ndarray) -> float:
    """Compute path length for x in an IsolationTree."""
    nodes = tree._state['nodes'] if hasattr(tree, '_state') and isinstance(tree._state, dict) and 'nodes' in tree._state else getattr(tree, 'nodes', None)
    if nodes is None:
        return 1.0

    node_idx = 0
    depth = 0
    while True:
        node = nodes[node_idx]
        left_child = int(node['left_child'])
        right_child = int(node['right_child'])

        if left_child == -1: # Leaf
            n_samples = int(node['n_node_samples'])
            if n_samples <= 1:
                c = 0.0
            elif n_samples == 2:
                c = 1.0
            else:
                c = 2.0 * (math.log(n_samples - 1) + 0.5772156649) - (2.0 * (n_samples - 1) / n_samples)
            return depth + c

        f_idx = int(node['feature'])
        thresh = float(node['threshold'])
        if x[f_idx] <= thresh:
            node_idx = left_child
        else:
            node_idx = right_child
        depth += 1


def _predict_isolation_forest(ad_model: Any, X_row: np.ndarray) -> Tuple[bool, float, float]:
    """Compute anomaly flag, anomaly score and decision score."""
    estimators = ad_model.estimators_
    n_estimators = len(estimators)
    if n_estimators == 0:
        return False, 0.0, 0.0

    depths = [_eval_isolation_tree(est.tree_, X_row) for est in estimators]
    mean_depth = float(np.mean(depths))

    # 211157 is training healthy sample count
    n_samples = getattr(ad_model, 'max_samples_', 256)
    if n_samples > 2:
        c = 2.0 * (math.log(n_samples - 1) + 0.5772156649) - (2.0 * (n_samples - 1) / n_samples)
    else:
        c = 1.0

    score = float(2.0 ** (- (mean_depth / c))) # standard IF anomaly score (0 to 1, >0.5 -> anomaly)
    offset = float(getattr(ad_model, 'offset_', -0.5))
    decision_score = - (score + offset)
    is_anomaly = (score >= 0.52) # Standard calibrated threshold
    return is_anomaly, score, decision_score


# -------------------------------------------------------------------------
# Feature Extraction & Health Scoring
# -------------------------------------------------------------------------

def compute_sensor_health_score(mean_z: float, max_abs_z: float, std_z: float, slope_z: float) -> float:
    """Compute 0-100 health score for an individual sensor channel."""
    penalty = 0.0
    abs_mean = abs(mean_z)

    # Mean z penalty
    if abs_mean > 2.0:
        penalty += min(60.0, (abs_mean - 2.0) * 15.0)
    # Peak z penalty
    if max_abs_z > 3.0:
        penalty += min(30.0, (max_abs_z - 3.0) * 8.0)
    # Trend slope penalty
    if abs(slope_z) > 0.05:
        penalty += min(20.0, (abs(slope_z) - 0.05) * 200.0)

    score = max(0.0, min(100.0, 100.0 - penalty))
    return score


def estimate_rul(health_history: List[float], timestamps: Optional[np.ndarray] = None, failure_threshold: float = 20.0) -> Optional[float]:
    """Estimate remaining useful life in seconds using linear degradation slope."""
    if len(health_history) < 15:
        return None

    y = np.array(health_history, dtype=np.float64)
    x = np.arange(len(y)) if timestamps is None else np.array(timestamps, dtype=np.float64)

    # Linear regression
    x_mean = np.mean(x)
    y_mean = np.mean(y)
    cov = np.sum((x - x_mean) * (y - y_mean))
    var_x = np.sum((x - x_mean) ** 2)

    if var_x < 1e-6:
        return None

    slope = cov / var_x
    if slope >= -0.005: # Not degrading significantly
        return None

    current_health = y[-1]
    if current_health <= failure_threshold:
        return 0.0

    t_to_fail = (failure_threshold - current_health) / slope
    return float(max(0.0, min(7200.0, t_to_fail)))


# -------------------------------------------------------------------------
# Unified Health Monitoring Engine
# -------------------------------------------------------------------------

class EngineHealthPipeline:
    """
    End-to-End Engine Health Monitoring and Diagnostic Engine.
    """
    def __init__(
        self,
        nominal_twin_dir: str = "ML/models/nominal_twin",
        fault_classifier_dir: str = "ML/models/fault_classifier",
        anomaly_detector_dir: str = "ML/models/anomaly_detector",
        healthy_stats_path: str = "ML/data/processed/residuals/healthy_residual_stats.json",
        residual_domain: str = "training",
    ):
        """residual_domain selects which residual calibration to normalise with.

        "training" — statistics measured on data/runs_v3, the domain the twin was
        fitted on. Correct for anything replaying runs_v3, and for building
        training features (train/serve consistency demands the SAME
        normalisation on both sides).

        "ops" — statistics measured on OpsEngineSim, the live server_ops flight
        model. Correct for real-time inference under server_ops, and REQUIRED
        there: the twin has systematic bias on that domain, so leaving it
        uncorrected turns modelling error into phantom degradation.
        """
        base_dir = Path(__file__).parent
        twin_path = base_dir / nominal_twin_dir
        fc_path = base_dir / fault_classifier_dir
        ad_path = base_dir / anomaly_detector_dir
        stats_file = base_dir / healthy_stats_path

        # 1. Load Nominal Twin Bundle
        bundle_file = twin_path / "nominal_twin_bundle.joblib"
        if not bundle_file.exists():
            raise FileNotFoundError(f"Missing {bundle_file}")
        with open(bundle_file, "rb") as f:
            self.twin_bundle = joblib.load(f)
        self.twin_models = self.twin_bundle["models"]

        # 2. Load Fault Classifier
        fc_file = fc_path / "fault_classifier.joblib"
        with open(fc_file, "rb") as f:
            self.fault_classifier = joblib.load(f)

        # 3. Load Anomaly Detector
        ad_file = ad_path / "anomaly_detector.joblib"
        with open(ad_file, "rb") as f:
            self.anomaly_detector = joblib.load(f)

        # 4. Load or compute healthy baseline stats
        if not stats_file.exists():
            self._generate_baseline_stats(stats_file)

        with open(stats_file, "r", encoding="utf-8") as f:
            sdata = json.load(f)
            self.healthy_stats = sdata.get("sensor_stats", sdata)

        # 4b. DOMAIN CALIBRATION.
        #
        # The statistics above were measured on data/runs_v3, produced by
        # simulator/context.py's KinematicContextGenerator. Live inference under
        # server_ops runs against OpsEngineSim + OpsContextGenerator: a different
        # flight-dynamics model with a PID autopilot, visiting operating points
        # the twin never trained on. The twin's error there is a systematic
        # OFFSET, not noise, and with healthy sigmas as tight as 0.38 degC on CHT
        # a mere 2 degC of model bias reads as 5.5 sigma. That is what made a
        # perfectly healthy climb report cooling health 0 and diagnose a compound
        # lubrication fault with nothing wrong with the engine.
        #
        # Normalising residuals against statistics gathered on the SAME
        # distribution you infer over is the standard remedy.
        # calibrate_ops_residuals.py generates this file; without it we fall back
        # to the training-domain statistics and behave exactly as before.
        self.phase_stats = {}
        self.residual_domain = residual_domain
        ops_stats_file = stats_file.parent / "healthy_residual_stats_ops.json"
        if residual_domain == "ops" and ops_stats_file.exists():
            with open(ops_stats_file, "r", encoding="utf-8") as f:
                odata = json.load(f)
            self.healthy_stats = odata.get("sensor_stats", self.healthy_stats)
            self.phase_stats = odata.get("sensor_stats_by_phase", {})

        # Feature order
        feats_file = fc_path / "feature_names.json"
        if feats_file.exists():
            with open(feats_file, "r") as f:
                raw_data = json.load(f)
                self.feature_names = raw_data.get("feature_names", raw_data) if isinstance(raw_data, dict) else raw_data
        else:
            self.feature_names = [f"window_{feat}_z_{s}" for s in SENSOR_COLS for feat in ["mean", "std", "slope", "max_abs"]]

    def _generate_baseline_stats(self, out_path: Path):
        """Generate baseline healthy residual statistics from available healthy runs."""
        print("Generating baseline healthy residual statistics...", flush=True)
        runs_dir = Path(__file__).parent / "data/runs_v2"
        if not runs_dir.exists():
            runs_dir = Path(__file__).parent / "data/runs"
        manifest_file = runs_dir / "dataset_summary.json"

        healthy_res = {s: [] for s in SENSOR_COLS}
        if manifest_file.exists():
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            h_flights = [item["flight_id"] for item in manifest.get("manifest", []) if item.get("category") == "healthy"][:5]
            for fid in h_flights:
                fpath = runs_dir / f"{fid}.parquet"
                if fpath.exists():
                    fdf = pd.read_parquet(fpath, engine="fastparquet").iloc[::25] # subsample for instant calibration
                    pred_df = self.predict_nominal_twin(fdf[CONTEXT_COLS])
                    for s in SENSOR_COLS:
                        res = (fdf[s] - pred_df[s]).to_numpy()
                        healthy_res[s].extend(res)

        stats = {}
        for s in SENSOR_COLS:
            vals = np.array(healthy_res[s]) if len(healthy_res[s]) > 0 else np.array([0.0, 1.0])
            std_v = float(np.std(vals, ddof=1)) if len(vals) > 1 else 1.0
            stats[s] = {
                "mean": float(np.mean(vals)),
                "std": std_v if std_v > 1e-6 else 1.0,
                "min": float(np.min(vals)),
                "max": float(np.max(vals))
            }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"sensor_stats": stats}, f, indent=2)

    def _encode_context(self, context_df: pd.DataFrame) -> np.ndarray:
        """Encode 5 context variables (4 numeric + One-Hot phase)."""
        num_cols = ["throttle_pct", "alt_m", "oat_c", "ias_kt"]
        num_data = context_df[num_cols].to_numpy(dtype=np.float64)

        phases = context_df["phase"].astype(str).str.upper().tolist()
        n_samples = len(phases)
        one_hot = np.zeros((n_samples, len(PHASE_CATEGORIES)), dtype=np.float64)
        for i, p in enumerate(phases):
            if p in PHASE_CATEGORIES:
                one_hot[i, PHASE_CATEGORIES.index(p)] = 1.0

        return np.hstack([num_data, one_hot])

    def predict_nominal_twin(self, context_df: pd.DataFrame) -> pd.DataFrame:
        """Predict expected healthy 19 sensor channels using Model 1."""
        X_mat = self._encode_context(context_df)
        preds = {}
        for s in SENSOR_COLS:
            model = self.twin_models[s]
            preds[s] = _predict_hgb_regressor(model, X_mat)
        return pd.DataFrame(preds, index=context_df.index)

    def _stats_for(self, sensor: str, phase: Optional[str]) -> Tuple[float, float]:
        """Calibrated (mean, std) for a channel, preferring the current flight
        phase when a per-phase calibration is available.

        The twin's bias is phase-dependent — measured at -5.1 sigma on oil temp
        in CLIMB versus 0.0 in CRUISE on the very same healthy engine — so one
        global correction cannot flatten it. Falls back to the global figures,
        then to (0, 1), so a missing calibration degrades rather than breaks.
        """
        if phase:
            ps = self.phase_stats.get(str(phase), {}).get(sensor)
            if ps and ps.get("std", 0.0) > 1e-6:
                return float(ps.get("mean", 0.0)), float(ps["std"])
        gs = self.healthy_stats.get(sensor, {})
        std_v = float(gs.get("std", 1.0))
        return float(gs.get("mean", 0.0)), std_v if std_v > 1e-6 else 1.0

    def extract_features(self, telemetry_window: pd.DataFrame) -> Tuple[Dict[str, float], Dict[str, float]]:
        """Extract 76 rolling window residual z-score features."""
        # 1. Predict nominal baseline
        pred_df = self.predict_nominal_twin(telemetry_window[CONTEXT_COLS])

        # 2. Residuals and z-scores
        feats: Dict[str, float] = {}
        sensor_scores: Dict[str, float] = {}

        # Per-SAMPLE phase, not one phase for the whole window.
        #
        # A 60-second window early in a sortie spans STARTUP, TAXI, TAKEOFF and
        # CLIMB, and the twin's bias differs sharply between them. Normalising
        # all 60 samples by the last sample's phase mis-scales the other 59 and
        # is why the first window of every flight scored so badly — the exact
        # "faulty data during taxi/takeoff" symptom. retrain_fault_classifier.py
        # builds training features the same way, so the two stay consistent.
        phases = (
            telemetry_window["phase"].astype(str).to_numpy()
            if "phase" in telemetry_window.columns
            else np.array([""] * len(telemetry_window))
        )
        uniq = {p: None for p in phases}

        for s in SENSOR_COLS:
            actual = telemetry_window[s].to_numpy(dtype=np.float64)
            pred = pred_df[s].to_numpy(dtype=np.float64)
            res = actual - pred

            # Centre on the calibrated mean. This file already carried a "mean"
            # per channel and never used it — z was res/std — so any systematic
            # twin bias passed straight through into the health score as though
            # it were engine degradation.
            lut = {p: self._stats_for(s, p or None) for p in uniq}
            mean_val = np.array([lut[p][0] for p in phases], dtype=np.float64)
            std_val = np.array([lut[p][1] for p in phases], dtype=np.float64)
            z = (res - mean_val) / std_val

            mean_z = float(np.mean(z))
            std_z = float(np.std(z, ddof=1)) if len(z) > 1 else 0.0
            max_abs_z = float(np.max(np.abs(z)))

            # Trend slope (z per second)
            t = np.arange(len(z), dtype=np.float64)
            t_mean = np.mean(t)
            var_t = np.sum((t - t_mean) ** 2)
            slope_z = float(np.sum((t - t_mean) * (z - mean_z)) / var_t) if var_t > 1e-6 else 0.0

            feats[f"window_mean_z_{s}"] = mean_z
            feats[f"window_std_z_{s}"] = std_z
            feats[f"window_slope_z_{s}"] = slope_z
            feats[f"window_max_abs_z_{s}"] = max_abs_z

            sensor_scores[s] = compute_sensor_health_score(mean_z, max_abs_z, std_z, slope_z)

        return feats, sensor_scores

    def predict(self, telemetry_window: pd.DataFrame, health_history: Optional[List[float]] = None) -> Dict[str, Any]:
        """
        Execute end-to-end diagnosis on incoming 60-second telemetry window.
        """
        if len(telemetry_window) < 60:
            raise ValueError(f"telemetry_window requires at least 60 rows, got {len(telemetry_window)}")

        # 1. Feature extraction
        feats, sensor_scores = self.extract_features(telemetry_window)

        # 2. Subsystem health calculation
        subsystem_scores = {}
        for sub, sensors in SUBSYSTEM_MAP.items():
            scores = [sensor_scores[s] for s in sensors if s in sensor_scores]
            # Subsystem score is minimum of its sensors (weakest link)
            subsystem_scores[sub] = float(np.min(scores)) if scores else 100.0

        overall_health = float(np.mean(list(subsystem_scores.values())))

        # 3. Model 2: Fault Classification
        feat_vec = np.array([feats[f] for f in self.feature_names], dtype=np.float64)
        fault_type, confidence, probabilities = _predict_hgb_classifier(self.fault_classifier, feat_vec)

        # 4. Model 3: Unsupervised Anomaly Detection
        is_anomaly, anom_score, decision_score = _predict_isolation_forest(self.anomaly_detector, feat_vec)

        # If fault is detected, anomaly is true
        if fault_type != "healthy":
            is_anomaly = True

        # 5. Prognosis / RUL
        rul_history = list(health_history) if health_history is not None else [overall_health]
        rul_seconds = estimate_rul(rul_history)

        # 6. Explanations
        explanations = {
            "health_overall": f"Overall engine health = {overall_health:.1f}/100 " +
                              ("([CRITICAL] severe anomaly detected)" if overall_health < 50 else
                               "([DEGRADED] sub-system wear detected)" if overall_health < 80 else
                               "(nominal operating condition)"),
            "diagnosed_fault": f"Diagnosed failure mode: {fault_type} (confidence: {confidence * 100:.2f}%)",
            "subsystems": {sub: f"{sub} health = {score:.1f}/100" for sub, score in subsystem_scores.items()}
        }

        return {
            "health_score": round(overall_health, 1),
            "subsystem_scores": {k: round(v, 1) for k, v in subsystem_scores.items()},
            "fault_type": fault_type,
            "confidence": round(confidence, 6),
            "anomaly": is_anomaly,
            "anomaly_score": round(anom_score, 4),
            "remaining_useful_life": round(rul_seconds, 1) if rul_seconds is not None else None,
            "probabilities": {k: round(v, 6) for k, v in probabilities.items()},
            "explanations": explanations
        }


# Global singleton
_PIPELINE: Optional[EngineHealthPipeline] = None

def get_engine_pipeline() -> EngineHealthPipeline:
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = EngineHealthPipeline()
    return _PIPELINE

def predict_engine(telemetry_df: pd.DataFrame, health_history: Optional[List[float]] = None) -> Dict[str, Any]:
    """Public helper function for engine health and fault prediction."""
    pipeline = get_engine_pipeline()
    return pipeline.predict(telemetry_df, health_history)
