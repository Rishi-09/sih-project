"""
Telemetry Data Schema Definition and Validation for R2 ML.

Defines the expected column sets for flight telemetry:
- 5 Context Inputs
- 19 Engine Sensor Outputs
- Metadata / Ground-Truth Columns
"""

from typing import Dict, List, Tuple, Union
import pandas as pd

# 5 Context Inputs
CONTEXT_COLS: List[str] = [
    "throttle_pct",
    "alt_m",
    "oat_c",
    "ias_kt",
    "phase",
]

# 19 Engine Sensor Outputs
SENSOR_COLS: List[str] = [
    "rpm",
    "vib_rms_g",
    "egt_1",
    "egt_2",
    "egt_3",
    "egt_4",
    "cht_1",
    "cht_2",
    "cht_3",
    "cht_4",
    "coolant_temp_c",
    "oil_press_bar",
    "oil_temp_c",
    "map_kpa",
    "fuel_flow_lph",
    "fuel_press_bar",
    "inj_timing_deg",
    "bus_voltage_v",
    "alt_current_a",
]

# Ground-truth / Metadata columns
METADATA_COLS: List[str] = [
    "run_id",
    "timestamp",
    "fault_label",
    "severity",
    "t_to_redline",
]

ALL_REQUIRED_COLS: List[str] = CONTEXT_COLS + SENSOR_COLS + METADATA_COLS

N_CONTEXT: int = len(CONTEXT_COLS)  # 5
N_SENSORS: int = len(SENSOR_COLS)   # 19


class SchemaValidationError(Exception):
    """Raised when telemetry data fails schema validation."""
    pass


def validate_columns(
    df: pd.DataFrame,
    expected_cols: List[str],
    column_group_name: str = "required",
) -> Tuple[bool, List[str]]:
    """
    Check if expected columns exist in the DataFrame.

    Returns:
        Tuple[bool, List[str]]: (is_valid, list of missing columns)
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"Expected pandas.DataFrame, got {type(df).__name__}")

    existing_cols = set(df.columns)
    missing = [col for col in expected_cols if col not in existing_cols]
    return (len(missing) == 0, missing)


def validate_context_cols(df: pd.DataFrame) -> Tuple[bool, List[str]]:
    """Validate presence of all 5 context input columns."""
    return validate_columns(df, CONTEXT_COLS, column_group_name="context")


def validate_sensor_cols(df: pd.DataFrame) -> Tuple[bool, List[str]]:
    """Validate presence of all 19 engine sensor output columns."""
    return validate_columns(df, SENSOR_COLS, column_group_name="sensor")


def validate_metadata_cols(df: pd.DataFrame) -> Tuple[bool, List[str]]:
    """Validate presence of all metadata columns."""
    return validate_columns(df, METADATA_COLS, column_group_name="metadata")


def validate_dataframe_schema(
    df: pd.DataFrame,
    raise_error: bool = False,
) -> Tuple[bool, Dict[str, List[str]]]:
    """
    Validate full schema of a telemetry DataFrame against CONTEXT_COLS, SENSOR_COLS, and METADATA_COLS.

    Args:
        df: Telemetry DataFrame to validate.
        raise_error: If True, raises SchemaValidationError when validation fails.

    Returns:
        Tuple[bool, Dict[str, List[str]]]:
            - is_valid: True if all columns exist, False otherwise.
            - missing_by_group: Dictionary mapping group names to lists of missing columns.
    """
    ctx_valid, ctx_missing = validate_context_cols(df)
    sns_valid, sns_missing = validate_sensor_cols(df)
    meta_valid, meta_missing = validate_metadata_cols(df)

    missing_by_group: Dict[str, List[str]] = {}
    if ctx_missing:
        missing_by_group["context"] = ctx_missing
    if sns_missing:
        missing_by_group["sensor"] = sns_missing
    if meta_missing:
        missing_by_group["metadata"] = meta_missing

    is_valid = ctx_valid and sns_valid and meta_valid

    if not is_valid and raise_error:
        error_details = []
        for group, missing_cols in missing_by_group.items():
            error_details.append(f"{group} missing: {missing_cols}")
        msg = f"Telemetry DataFrame failed schema validation -> {'; '.join(error_details)}"
        raise SchemaValidationError(msg)

    return is_valid, missing_by_group
