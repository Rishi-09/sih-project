"""
Retrain the 91-class fault classifier — the active one DIVERGED during training.

EVIDENCE
--------
Maximum |leaf value| per boosting iteration in the shipped artifact
(ML/models/fault_classifier/fault_classifier.joblib):

    iter  0:          9.1
    iter  1:        924.8
    iter  2:      46375.9
    ...
    iter 10:     111034.9      <- early stopping fired here, on 11 iterations

For comparison, the nominal-twin regressor beside it converges normally
(413 -> 372 -> 334 -> ... -> 4.5). A gradient-boosted model whose leaf values
grow four orders of magnitude is diverging, and early stopping halted it not
because it had converged but because validation loss was getting worse.

The consequence is severe and easy to reproduce: on flights the model was
LITERALLY TRAINED ON, with ground truth `fault_label == "healthy"` and a health
score of 100.0, it returns P(healthy) = 0.000 and predicts triple-compound
faults with full confidence. Raw scores reach +3117 / -9440 where a correctly
fitted model of this size should sit within a few log-odds.

CAUSE
-----
    l2_regularization = 0.0   with   class_weight = "balanced"   over 91 classes

A histogram GBM sets each leaf to  -sum_gradients / (sum_hessians + l2).  The
multinomial hessian is p(1 - p), which approaches zero for the many rare
compound classes; `class_weight="balanced"` then multiplies those tiny values by
a very large weight. With l2 exactly 0 there is nothing holding the denominator
off zero, so leaf values explode and each boosting round amplifies the last.
min_samples_leaf=20 does not help — it bounds sample COUNT, not hessian mass.

THE FIX
-------
A non-zero l2_regularization, a gentler learning rate, and patience for early
stopping. Everything else is kept identical so the artifact stays a drop-in
replacement: same 76 features in the same order, same class label set, same
joblib layout that pure_engine_ml.py's loader expects.

Features are built through the SAME normalisation the inference path uses
(residual_domain="training", because this trains on runs_v3) — train/serve skew
here would simply move the bug rather than fix it.

USAGE
-----
    python retrain_fault_classifier.py --flights 400
    python retrain_fault_classifier.py --flights 1500 --out ML/models/fault_classifier

The previous artifacts are copied to a timestamped backup before anything is
overwritten.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Import order matters and is not negotiable.
#
# pure_engine_ml installs a meta-path finder that shadows EVERY module whose
# name starts with "sklearn", "_loss" or "scipy", handing back stub classes so
# the 1.8.0-pickled artifacts can be unpickled without the real library. That is
# fine for inference, but we need real sklearn to FIT a model — and a stub has
# no .fit, which is exactly how a 65-minute feature extraction ended in
# AttributeError the first time this script ran.
#
# sys.modules is consulted before sys.meta_path, so importing the real sklearn
# FIRST wins permanently. Do not move these below the pure_engine_ml import.
# ---------------------------------------------------------------------------
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd

from pure_engine_ml import EngineHealthPipeline, CONTEXT_COLS, SENSOR_COLS

BASE = Path(__file__).parent
DATA_ROOTS = [
    BASE / "data/runs_v3",
    Path(r"D:\Rishi\Retribution\data\runs_v3"),
]
WINDOW = 60
BATCH_FLIGHTS = 40  # flights per batched nominal-twin call


def find_flights() -> List[Path]:
    for root in DATA_ROOTS:
        if not root.exists():
            continue
        files = sorted(root.glob("**/flight_*.parquet"))
        if files:
            print(f"dataset: {root}  ({len(files)} flights)")
            return files
    raise SystemExit("no runs_v3 flights found in any known location")


def rolling_features(z: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Rolling mean / std / OLS slope / max|z| over WINDOW samples.

    Must match pure_engine_ml.extract_features exactly — same window length,
    same ddof=1 on the standard deviation, same ascending time index for the
    slope — or the classifier learns features the inference path never produces.
    """
    s = pd.Series(z)
    mean = s.rolling(WINDOW).mean().to_numpy()
    std = s.rolling(WINDOW).std(ddof=1).to_numpy()
    max_abs = s.abs().rolling(WINDOW).max().to_numpy()

    # OLS slope against t = 0..WINDOW-1 reduces to a fixed linear kernel.
    t = np.arange(WINDOW, dtype=np.float64)
    tc = t - t.mean()
    denom = float(np.sum(tc * tc))
    kernel = tc / denom
    # convolve(z, kernel[::-1], "full")[i] == sum_m z[m] * kernel[m - i + W - 1],
    # i.e. the window ENDING at i. Slicing from W-1 instead would take the window
    # starting at i and silently shift every slope by one window length.
    slope = np.convolve(z, kernel[::-1], mode="full")[: len(z)]
    slope[: WINDOW - 1] = np.nan
    return mean, std, slope, max_abs


def flight_features(pipe: EngineHealthPipeline, df: pd.DataFrame, stride: int, pred=None):
    """76-D feature rows plus their labels for one flight.

    `pred` lets a caller supply nominal-twin output computed for a whole batch
    of flights at once; without it the prediction is made here per flight.
    """
    if pred is None:
        pred = pipe.predict_nominal_twin(df[CONTEXT_COLS])
    phases = df["phase"].astype(str).to_numpy()

    cols: Dict[str, np.ndarray] = {}
    for s in SENSOR_COLS:
        res = df[s].to_numpy(np.float64) - pred[s].to_numpy(np.float64)
        # Per-sample calibrated normalisation, exactly as inference does it.
        mean_v = np.empty(len(res))
        std_v = np.empty(len(res))
        for i, ph in enumerate(phases):
            m, sd = pipe._stats_for(s, ph)
            mean_v[i] = m
            std_v[i] = sd
        z = (res - mean_v) / std_v
        m, sd, sl, mx = rolling_features(z)
        cols[f"window_mean_z_{s}"] = m
        cols[f"window_std_z_{s}"] = sd
        cols[f"window_slope_z_{s}"] = sl
        cols[f"window_max_abs_z_{s}"] = mx

    X = np.column_stack([cols[n] for n in pipe.feature_names])
    y = df["fault_label"].astype(str).to_numpy()
    valid = ~np.isnan(X).any(axis=1)
    idx = np.where(valid)[0][::stride]
    return X[idx], y[idx]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flights", type=int, default=400)
    ap.add_argument("--stride", type=int, default=10, help="sample every Nth window")
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=0.06)
    ap.add_argument("--max-iter", type=int, default=200)
    ap.add_argument("--out", type=str, default="ML/models/fault_classifier_fixed")
    args = ap.parse_args()

    files = find_flights()
    rng = np.random.default_rng(42)
    rng.shuffle(files)
    files = files[: args.flights]

    # Flight-level split — windows from one flight must never straddle train and
    # test, or neighbouring windows leak almost identical state across the split.
    n_test = max(1, len(files) // 5)
    test_files, train_files = files[:n_test], files[n_test:]
    print(f"train flights: {len(train_files)}   test flights: {len(test_files)}")

    pipe = EngineHealthPipeline()  # residual_domain="training" — matches runs_v3

    def collect(fs, tag):
        """Feature extraction, batched across flights.

        The cost is dominated by predict_nominal_twin: 19 gradient-boosted
        regressors, each traversed tree-by-tree in NumPy. That traversal has a
        fixed Python overhead per tree regardless of how many rows it scores, so
        calling it once per flight wastes most of the work. Concatenating a
        batch of flights into one call amortises it over far more rows.
        """
        Xs, ys = [], []
        t0 = time.time()
        for start in range(0, len(fs), BATCH_FLIGHTS):
            batch = fs[start : start + BATCH_FLIGHTS]
            frames = [pd.read_parquet(f) for f in batch]
            big = pd.concat(frames, ignore_index=True)
            pred = pipe.predict_nominal_twin(big[CONTEXT_COLS])
            off = 0
            for df in frames:
                n = len(df)
                X, y = flight_features(pipe, df, args.stride, pred.iloc[off : off + n].reset_index(drop=True))
                off += n
                if len(X):
                    Xs.append(X)
                    ys.append(y)
            done = min(start + BATCH_FLIGHTS, len(fs))
            el = time.time() - t0
            print(f"  {tag} {done}/{len(fs)} flights  {sum(len(a) for a in Xs)} windows  "
                  f"{el:.0f}s elapsed, ~{el/done*(len(fs)-done):.0f}s left", flush=True)
        return np.vstack(Xs), np.concatenate(ys)

    # Cache the extracted features. Extraction is the expensive half of this
    # script; a failure in the (fast) fitting half must never cost it again.
    cache = BASE / f"ML/data/processed/features_v3_f{args.flights}_s{args.stride}.npz"
    if cache.exists():
        print(f"loading cached features: {cache}")
        d = np.load(cache, allow_pickle=True)
        X_tr, y_tr, X_te, y_te = d["X_tr"], d["y_tr"], d["X_te"], d["y_te"]
    else:
        X_tr, y_tr = collect(train_files, "train")
        X_te, y_te = collect(test_files, "test ")
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache, X_tr=X_tr, y_tr=y_tr, X_te=X_te, y_te=y_te)
        print(f"cached features -> {cache}")
    print(f"\ntrain windows {X_tr.shape}  test windows {X_te.shape}  classes {len(set(y_tr))}")

    clf = HistGradientBoostingClassifier(
        random_state=42,
        learning_rate=args.lr,
        max_iter=args.max_iter,
        # The fix. Anything above zero keeps the leaf denominator away from the
        # vanishing multinomial hessians of the rare compound classes.
        l2_regularization=args.l2,
        class_weight="balanced",
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=15,
        min_samples_leaf=40,
    )
    t0 = time.time()
    clf.fit(X_tr, y_tr)
    print(f"fit: {time.time()-t0:.1f}s   iterations kept: {len(clf._predictors)}")

    mx = [max(np.abs(t.nodes[t.nodes['is_leaf'].astype(bool)]['value']).max() for t in it)
          for it in clf._predictors]
    print(f"max|leaf value|  first={mx[0]:.3f}  last={mx[-1]:.3f}  peak={max(mx):.3f}"
          f"   {'STILL DIVERGING' if max(mx) > 100 else 'converged'}")

    pred = clf.predict(X_te)
    proba = clf.predict_proba(X_te)
    classes = list(clf.classes_)
    acc = accuracy_score(y_te, pred)
    bal = balanced_accuracy_score(y_te, pred)
    f1m = f1_score(y_te, pred, average="macro", zero_division=0)
    f1w = f1_score(y_te, pred, average="weighted", zero_division=0)
    print(f"\nheld-out  accuracy={acc:.4f}  balanced={bal:.4f}  macroF1={f1m:.4f}  weightedF1={f1w:.4f}")

    # The check that actually matters for the console: on genuinely healthy
    # windows, does the model say healthy?
    if "healthy" in classes:
        hi = classes.index("healthy")
        m = y_te == "healthy"
        if m.any():
            print(f"healthy windows: n={m.sum()}  mean P(healthy)={proba[m, hi].mean():.4f}  "
                  f"correctly called healthy={np.mean(pred[m] == 'healthy'):.4f}")
        nm = ~m
        if nm.any():
            print(f"faulted windows: n={nm.sum()}  mean P(healthy)={proba[nm, hi].mean():.4f}  "
                  f"flagged not-healthy={np.mean(pred[nm] != 'healthy'):.4f}")

    out = BASE / args.out
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, out / "fault_classifier.joblib")
    (out / "feature_names.json").write_text(json.dumps({"feature_names": pipe.feature_names}, indent=2))
    (out / "class_labels.json").write_text(json.dumps({"class_labels": [str(c) for c in classes]}, indent=2))
    (out / "metadata.json").write_text(json.dumps({
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reason": "previous 91-class artifact diverged (l2_regularization=0.0 with class_weight=balanced)",
        "l2_regularization": args.l2,
        "learning_rate": args.lr,
        "max_iter": args.max_iter,
        "min_samples_leaf": 40,
        "iterations_kept": len(clf._predictors),
        "max_leaf_value_last_iter": float(mx[-1]),
        "n_train_windows": int(X_tr.shape[0]),
        "n_test_windows": int(X_te.shape[0]),
        "n_train_flights": len(train_files),
        "n_test_flights": len(test_files),
        "window_stride": args.stride,
        "residual_domain": "training",
        "metrics": {"accuracy": acc, "balanced_accuracy": bal, "macro_f1": f1m, "weighted_f1": f1w},
    }, indent=2))
    print(f"\nwrote {out}")
    print("Not activated. To adopt it, back up ML/models/fault_classifier/ and copy these files in.")


if __name__ == "__main__":
    main()
