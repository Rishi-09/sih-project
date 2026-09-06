# R2 ML Engine Diagnostic & Prognostic Pipeline: Backend Handoff Guide

## 1. System Purpose & Overview
The **R2 ML Engine Health Monitoring System** is an end-to-end predictive diagnostic and prognostic solution designed for real-time aircraft engine telemetry analysis. 

The system operates without requiring any prior fault labels or maintenance annotations at runtime. It consumes a sliding temporal window ($\ge 60$ seconds) of raw engine sensor data and ambient context variables, executes a multi-tiered predictive pipeline, and outputs:
1. **Explainable Health Indices (0–100)**: Subsystem-level and overall engine health scores with deterministic diagnostic rationales.
2. **Fault Classification**: Categorization into specific failure modes with calibrated probability distributions.
3. **Unsupervised Anomaly Detection**: Isolation Forest outlier scoring against nominal healthy operating envelopes.
4. **Prognosis / Remaining Useful Life (RUL)**: Linear extrapolation of degradation trajectories to failure thresholds ($20.0$).

---

## 2. Production Entry Point & Installation

```python
from src.inference import predict

# telemetry_df must be a pandas DataFrame with >= 60 rows containing
# 5 context columns and 19 engine sensor channels.
result = predict(telemetry_df)
```

The inference pipeline dynamically caches trained model artifacts (Models 1, 2, and 3, baseline residual statistics, and encoders) in memory on first call (singleton pattern), enabling microsecond subsequent inference speeds.

---

## 3. Required Input Telemetry Schema

The input to `predict(telemetry_window)` must be a `pandas.DataFrame` containing at least **60 consecutive 1-second telemetry rows** ($N \ge 60$).

### A. Context Columns (5 Required)
| Column Name | Data Type | Physical Unit | Description |
| :--- | :--- | :--- | :--- |
| `throttle_pct` | `float` | `%` (0.0 to 100.0) | Pilot power lever throttle position |
| `alt_m` | `float` | Meters (`m`) | Pressure altitude above sea level |
| `oat_c` | `float` | Degrees Celsius (`°C`) | Outside ambient air temperature |
| `ias_kt` | `float` | Knots (`kt`) | Indicated airspeed |
| `phase` | `str` | Categorical String | Flight phase (`climb`, `cruise`, `descent`, `takeoff`, `idle`) |

### B. Engine Sensor Columns (19 Required)
| Column Name | Data Type | Physical Unit | Subsystem | Description |
| :--- | :--- | :--- | :--- | :--- |
| `rpm` | `float` | RPM | Mechanical | Engine crankshaft rotational speed |
| `vib_rms_g` | `float` | $g$ (RMS) | Mechanical | Engine block vibration magnitude |
| `egt_1` | `float` | Degrees Celsius (`°C`) | Combustion | Exhaust Gas Temp Cylinder 1 |
| `egt_2` | `float` | Degrees Celsius (`°C`) | Combustion | Exhaust Gas Temp Cylinder 2 |
| `egt_3` | `float` | Degrees Celsius (`°C`) | Combustion | Exhaust Gas Temp Cylinder 3 |
| `egt_4` | `float` | Degrees Celsius (`°C`) | Combustion | Exhaust Gas Temp Cylinder 4 |
| `cht_1` | `float` | Degrees Celsius (`°C`) | Cooling | Cylinder Head Temp Cylinder 1 |
| `cht_2` | `float` | Degrees Celsius (`°C`) | Cooling | Cylinder Head Temp Cylinder 2 |
| `cht_3` | `float` | Degrees Celsius (`°C`) | Cooling | Cylinder Head Temp Cylinder 3 |
| `cht_4` | `float` | Degrees Celsius (`°C`) | Cooling | Cylinder Head Temp Cylinder 4 |
| `coolant_temp_c`| `float` | Degrees Celsius (`°C`) | Cooling | Engine liquid coolant temperature |
| `oil_press_bar` | `float` | Bar | Lubrication | Engine oil line pressure |
| `oil_temp_c` | `float` | Degrees Celsius (`°C`) | Lubrication | Engine oil sump temperature |
| `map_kpa` | `float` | kPa | Induction | Manifold Absolute Pressure |
| `fuel_flow_lph` | `float` | Liters / Hour (`L/h`) | Fuel | Total fuel delivery volume rate |
| `fuel_press_bar`| `float` | Bar | Fuel | Fuel rail pressure |
| `inj_timing_deg`| `float` | Crank degrees (`°`) | Injection | Electronic fuel injector timing offset |
| `bus_voltage_v` | `float` | Volts (`V`) | Electrical | Primary electrical bus DC voltage |
| `alt_current_a` | `float` | Amperes (`A`) | Electrical | Engine alternator output current |

> [!WARNING]
> **Ground-Truth Invariant:** Columns `fault_label`, `severity`, and `t_to_redline` are ground-truth simulator evaluation targets only. **NEVER pass these fields into the production `predict()` function.**

---

## 4. Exact Output JSON Contract

Every call to `predict()` returns a typed Python dictionary conforming to this structure:

```json
{
  "health_score": 92.8,
  "subsystem_scores": {
    "lubrication": 93.5,
    "cooling": 94.1,
    "combustion": 89.2,
    "fuel": 96.0,
    "mechanical": 97.4,
    "induction": 95.8,
    "electrical": 98.1,
    "injection": 95.3
  },
  "fault_type": "healthy",
  "confidence": 0.999999,
  "anomaly": false,
  "anomaly_score": -0.2322,
  "decision_score": 0.2322,
  "remaining_useful_life": null,
  "explanations": {
    "health_overall": "Overall engine health = 92.8 (nominal operating condition across all subsystems)",
    "subsystems": {
      "lubrication": "lubrication health = 93.5 (nominal, all sensor residuals within expected bounds)",
      "cooling": "cooling health = 94.1 (nominal, all sensor residuals within expected bounds)",
      "combustion": "combustion health = 89.2 (minor deviation in egt_3)",
      "fuel": "fuel health = 96.0 (nominal)",
      "mechanical": "mechanical health = 97.4 (nominal)",
      "induction": "induction health = 95.8 (nominal)",
      "electrical": "electrical health = 98.1 (nominal)",
      "injection": "injection health = 95.3 (nominal)"
    },
    "rul": "Health index is stable/improving (slope: +0.0012/s, current health: 92.8); failure threshold (20.0) is not projected to be reached."
  },
  "probabilities": {
    "healthy": 0.99999938,
    "bearing_wear": 1.12e-08,
    "cooling_failure": 2.34e-08,
    "electrical_degradation": 1.05e-08,
    "fuel_system_degradation": 1.45e-08,
    "ignition_fault_cyl3": 3.12e-08,
    "induction_loss": 4.48e-08,
    "injector_fault_cyl3": 2.91e-08,
    "lubrication_degradation": 1.71e-07,
    "sensor_drift_oilpress": 1.71e-07,
    "sensor_freeze_coolant": 1.15e-08
  }
}
```

---

## 5. Output Field Definitions

| Field Name | Type | Value Range | Description |
| :--- | :--- | :--- | :--- |
| `health_score` | `float` | `0.0` to `100.0` | Overall engine health score ($100 = \text{nominal}, 0 = \text{failed}$). |
| `subsystem_scores` | `dict` | `0.0` to `100.0` | Health score breakdown across the 8 mechanical/thermal engine subsystems. |
| `fault_type` | `str` | Category String | Predicted primary fault mode (`healthy`, `cooling_failure`, `lubrication_degradation`, `sensor_drift_oilpress`, etc.). |
| `confidence` | `float` | `0.0` to `1.0` | Calibrated model posterior probability for the top predicted fault class. |
| `anomaly` | `bool` | `True` / `False` | Unsupervised anomaly flag triggered if window falls outside healthy distribution. |
| `anomaly_score` | `float` | Continuous $(-\infty, +\infty)$ | Outlier magnitude ($- \text{decision\_function}$). Positive indicates abnormal behavior. |
| `decision_score` | `float` | Continuous $(-\infty, +\infty)$ | Raw IsolationForest decision margin. |
| `remaining_useful_life` | `float` or `null` | Seconds (`s`) $\ge 0.0$ | Estimated time remaining until engine health reaches the failure threshold ($20.0$). Returns `null` if health is stable or insufficient history exists. |
| `explanations` | `dict` | Human Text | Dynamic text explanations for overall health, all 8 subsystems, and RUL trend. |
| `probabilities` | `dict` | `0.0` to `1.0` | Full multiclass probability vector over all known fault categories. |

---

## 6. Input Validation & Error Handling

The pipeline enforces strict input validation:
- **Missing Columns:** Raises `ValueError("Missing required context columns: [...]")` or `ValueError("Missing required sensor columns: [...]")`.
- **Window Length:** Raises `ValueError("Telemetry input has N rows; a full 60-second window requires at least 60 rows.")`.
- **Unseen Flight Phase:** Handled automatically via `OneHotEncoder(handle_unknown="ignore")` without throwing runtime errors.
- **Extra Columns:** Extra metadata columns (such as timestamps `t_s` or telemetry sequence IDs) are safely ignored.

---

## 7. Example Python Integration

```python
import pandas as pd
from src.inference import predict

# 1. Fetch recent 60-second telemetry buffer from backend database or queue
telemetry_buffer_df = pd.DataFrame({
    "throttle_pct": [...],      # 60 floats
    "alt_m": [...],             # 60 floats
    "oat_c": [...],             # 60 floats
    "ias_kt": [...],            # 60 floats
    "phase": ["cruise"] * 60,   # 60 strings
    "rpm": [...],               # 60 floats
    # ... all 19 sensor channels
})

# 2. Execute inference
diagnostic_result = predict(telemetry_buffer_df)

# 3. Check health and trigger alerts
if diagnostic_result["health_score"] < 50.0 or diagnostic_result["fault_type"] != "healthy":
    print(f"ALERT: Engine fault detected: {diagnostic_result['fault_type']} (Conf: {diagnostic_result['confidence']:.2%})")
    print(f"Explanation: {diagnostic_result['explanations']['health_overall']}")
    if diagnostic_result["remaining_useful_life"] is not None:
        print(f"RUL to Redline: {diagnostic_result['remaining_useful_life']:.1f} seconds")
```
