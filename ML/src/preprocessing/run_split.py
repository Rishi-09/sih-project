"""
Run-Level Data Splitting Utilities for R2 ML.

Ensures that train/test splits are strictly performed at the flight/run level,
never randomly splitting individual telemetry rows across train and test sets.
"""

import random
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import numpy as np
import pandas as pd

from src.preprocessing.data_loader import (
    get_healthy_runs_from_manifest,
    get_all_runs_from_manifest,
)


def get_healthy_runs(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Any]:
    """
    Extract healthy runs from manifest.

    Args:
        manifest: Dataset summary or list of flight records.

    Returns:
        List of healthy run records or identifiers.
    """
    return get_healthy_runs_from_manifest(manifest)


def get_all_runs(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Any]:
    """
    Extract all runs from manifest.

    Args:
        manifest: Dataset summary or list of flight records.

    Returns:
        List of all run records or identifiers.
    """
    return get_all_runs_from_manifest(manifest)


def train_test_split_by_run(
    runs: Sequence[Any],
    test_size: float = 0.2,
    random_state: Optional[int] = 42,
    shuffle: bool = True,
) -> Tuple[List[Any], List[Any]]:
    """
    Split a collection of complete flight runs/identifiers into train and test sets.

    CRITICAL RULE:
    Splits are performed STRICTLY at the flight/run level, ensuring complete time-series
    runs are kept intact and not leaked across splits.

    Args:
        runs: List or sequence of run IDs, run records, or flight paths.
        test_size: Fraction of runs to include in the test split (0.0 to 1.0).
        random_state: Seed for random shuffling.
        shuffle: Whether to shuffle runs before splitting.

    Returns:
        Tuple[List[Any], List[Any]]: (train_runs, test_runs)

    Raises:
        ValueError: If runs is empty or test_size is invalid.
    """
    runs_list = list(runs)
    n_runs = len(runs_list)
    if n_runs == 0:
        raise ValueError("Cannot split empty runs sequence.")
    if not (0.0 < test_size < 1.0):
        raise ValueError(f"test_size must be strictly between 0.0 and 1.0, got {test_size}")

    if shuffle:
        rng = random.Random(random_state)
        shuffled = runs_list.copy()
        rng.shuffle(shuffled)
    else:
        shuffled = runs_list.copy()

    n_test = max(1, int(round(n_runs * test_size)))
    # Ensure at least 1 train run if there are >= 2 runs total
    if n_test >= n_runs and n_runs > 1:
        n_test = n_runs - 1

    train_runs = shuffled[:-n_test] if n_test < n_runs else []
    test_runs = shuffled[-n_test:]

    return train_runs, test_runs


def filter_dataframe_by_runs(
    df: pd.DataFrame,
    run_ids: Sequence[Any],
    run_col: str = "run_id",
) -> pd.DataFrame:
    """
    Filter a combined telemetry DataFrame by a list of allowed run IDs.

    Args:
        df: Telemetry DataFrame containing a run identifier column.
        run_ids: Sequence of allowed run IDs.
        run_col: Name of the run ID column in df (default: 'run_id').

    Returns:
        pd.DataFrame: Filtered DataFrame containing only matching runs.
    """
    if run_col not in df.columns:
        raise KeyError(f"Column '{run_col}' not found in DataFrame.")

    run_id_set = set(run_ids)
    return df[df[run_col].isin(run_id_set)].copy()
