"""
Data Loader Module for R2 ML.

Provides reusable utilities for:
- Loading individual flight Parquet files
- Loading and querying simulator dataset manifests
- Extracting healthy vs faulty run identifiers
- Loading and concatenating multiple flight files
- Validating telemetry data against expected schemas
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import pandas as pd

from src.preprocessing.schema import validate_dataframe_schema, SchemaValidationError


def load_flight(
    path: Union[str, Path],
    validate: bool = True,
) -> pd.DataFrame:
    """
    Load a single flight telemetry Parquet file.

    Args:
        path: Path to the Parquet file.
        validate: Whether to validate the loaded DataFrame against ALL_REQUIRED_COLS.

    Returns:
        pd.DataFrame: Loaded flight telemetry DataFrame.

    Raises:
        FileNotFoundError: If the specified file does not exist.
        SchemaValidationError: If validation fails and validate is True.
    """
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(f"Flight parquet file not found at: {file_path}")

    df = pd.read_parquet(file_path)

    if validate:
        validate_dataframe_schema(df, raise_error=True)

    return df


def load_manifest(path: Union[str, Path]) -> Dict[str, Any]:
    """
    Load the simulator dataset summary / manifest JSON file.

    Args:
        path: Path to the JSON manifest (e.g., 'data/runs/dataset_summary.json').

    Returns:
        Dict[str, Any]: Parsed manifest dictionary.

    Raises:
        FileNotFoundError: If the manifest file does not exist.
        ValueError: If the file is not valid JSON.
    """
    manifest_path = Path(path)
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest JSON file not found at: {manifest_path}")

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse manifest JSON at {manifest_path}: {e}")

    return manifest


def get_healthy_runs_from_manifest(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """
    Identify healthy runs from the manifest.

    A run is considered healthy if fault_label is 'healthy', 'none', 'nominal', None,
    or if is_faulty is False / fault_type is empty.

    Args:
        manifest: Manifest data (dict or list of run records).

    Returns:
        List[Dict[str, Any]]: List of healthy run records/entries.
    """
    runs = _extract_run_list(manifest)
    healthy_runs = []

    for run in runs:
        fault_label = str(run.get("fault_label", run.get("fault_type", "healthy"))).lower().strip()
        is_faulty = run.get("is_faulty", None)

        if is_faulty is False:
            healthy_runs.append(run)
        elif is_faulty is True:
            continue
        elif fault_label in ("healthy", "none", "nominal", "null", ""):
            healthy_runs.append(run)

    return healthy_runs


def get_faulty_runs_from_manifest(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """
    Identify faulty runs from the manifest.

    Args:
        manifest: Manifest data (dict or list of run records).

    Returns:
        List[Dict[str, Any]]: List of faulty run records/entries.
    """
    runs = _extract_run_list(manifest)
    faulty_runs = []

    for run in runs:
        fault_label = str(run.get("fault_label", run.get("fault_type", "healthy"))).lower().strip()
        is_faulty = run.get("is_faulty", None)

        if is_faulty is True:
            faulty_runs.append(run)
        elif is_faulty is False:
            continue
        elif fault_label not in ("healthy", "none", "nominal", "null", ""):
            faulty_runs.append(run)

    return faulty_runs


def get_all_runs_from_manifest(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """
    Extract all run records from the manifest.

    Args:
        manifest: Manifest data (dict or list of run records).

    Returns:
        List[Dict[str, Any]]: List of all run records.
    """
    return _extract_run_list(manifest)


def load_multiple_flights(
    file_paths: List[Union[str, Path]],
    validate: bool = True,
) -> pd.DataFrame:
    """
    Load multiple flight Parquet files and concatenate them into a single DataFrame.

    Args:
        file_paths: List of file paths to Parquet flights.
        validate: Whether to validate each file's schema before concatenating.

    Returns:
        pd.DataFrame: Concatenated flight telemetry DataFrame.

    Raises:
        ValueError: If file_paths is empty.
        FileNotFoundError: If any flight file is missing.
        SchemaValidationError: If any file fails schema validation.
    """
    if not file_paths:
        raise ValueError("file_paths list cannot be empty.")

    dfs = [load_flight(fp, validate=validate) for fp in file_paths]
    combined_df = pd.concat(dfs, ignore_index=True)
    return combined_df


def _extract_run_list(manifest: Union[Dict[str, Any], List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Helper to standardize manifest input into a list of run dictionaries."""
    if isinstance(manifest, list):
        return manifest
    elif isinstance(manifest, dict):
        if "runs" in manifest and isinstance(manifest["runs"], list):
            return manifest["runs"]
        elif "flights" in manifest and isinstance(manifest["flights"], list):
            return manifest["flights"]
        elif "dataset" in manifest and isinstance(manifest["dataset"], list):
            return manifest["dataset"]
        else:
            # Check if dict values are run records
            records = []
            for k, v in manifest.items():
                if isinstance(v, dict):
                    record = dict(v)
                    if "run_id" not in record:
                        record["run_id"] = k
                    records.append(record)
            if records:
                return records
            return [manifest]
    return []
