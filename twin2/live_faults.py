"""
Fault state for the live simulator (retribution/server_ops/ops_engine.py).

Replaces the old additive per-channel FaultManager. An engine fault ramps one
health factor from its current value to the catalog target over
ENGINE_FAULT_RAMP_S, and the physics (physics.apply_health) decides what every
channel does at every operating point. A sensor fault corrupts one reading
after noise and quantization and never touches the engine.

Faults accumulate. Re-injecting the same id replaces it (a new severity), which
is how the console's "update severity" works.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from .catalog import ENGINE_FAULT_RAMP_S, ENGINE_FAULTS, SENSOR_FAULTS, target_theta
from .physics import HF_HEALTHY


@dataclass
class _EngineFault:
    fault_id: str
    factor: int
    start: float
    target: float
    onset_t: float
    severity: float


@dataclass
class _SensorFault:
    fault_id: str
    channel: str
    mode: str
    magnitude: float
    ramp_s: float
    onset_t: float
    severity: float
    frozen: Optional[float] = None


@dataclass
class LiveFaultState:
    seed: Optional[int] = None
    engine: List[_EngineFault] = field(default_factory=list)
    sensors: List[_SensorFault] = field(default_factory=list)

    def __post_init__(self):
        self.rng = np.random.default_rng(None if self.seed is None else self.seed + 17)

    @staticmethod
    def known(fault_id: str) -> bool:
        return fault_id in ENGINE_FAULTS or fault_id in SENSOR_FAULTS

    def inject(self, fault_id: str, severity: float, t_now: float, onset_delay: float = 0.0):
        onset = t_now + max(0.0, onset_delay)
        if fault_id in ENGINE_FAULTS:
            i, target = target_theta(fault_id, severity)  # type: ignore[misc]
            start = float(self.theta(t_now)[i])  # ramp from wherever the factor is now
            self.engine = [f for f in self.engine if f.fault_id != fault_id]
            self.engine.append(_EngineFault(fault_id, i, start, target, onset, float(severity)))
        elif fault_id in SENSOR_FAULTS:
            spec = SENSOR_FAULTS[fault_id]
            self.sensors = [f for f in self.sensors if f.fault_id != fault_id]
            self.sensors.append(_SensorFault(
                fault_id, spec["channel"], spec["mode"], float(spec.get("magnitude", 0.0)),
                float(spec.get("rampSec", 1.0)), onset, float(severity)))
        else:
            raise ValueError(f"unknown fault id {fault_id!r}")

    def clear(self):
        self.engine.clear()
        self.sensors.clear()

    def theta(self, t: float) -> np.ndarray:
        """True health factors at simulated time t."""
        th = HF_HEALTHY.copy()
        for f in self.engine:
            if t < f.onset_t:
                continue
            k = min(1.0, (t - f.onset_t) / ENGINE_FAULT_RAMP_S)
            th[f.factor] = f.start + k * (f.target - f.start)
        return th

    def corrupt(self, sensors: Dict[str, float], t: float) -> Dict[str, float]:
        """Apply live sensor faults to already-quantized readings."""
        out = dict(sensors)
        for f in self.sensors:
            if t < f.onset_t or f.channel not in out:
                continue
            v = out[f.channel]
            mag = f.magnitude * f.severity
            if f.mode == "bias":
                v += mag
            elif f.mode == "drift":
                v += mag * min(1.0, (t - f.onset_t) / max(1e-6, f.ramp_s))
            elif f.mode == "frozen":
                if f.frozen is None:
                    f.frozen = v
                v = f.frozen
            elif f.mode == "dropout":
                if self.rng.random() < 0.25:
                    v = 0.0
            elif f.mode == "spike":
                if self.rng.random() < 0.05:
                    v += mag
            out[f.channel] = round(float(v), 3)
        return out

    def active_ids(self, t: float) -> List[str]:
        items = [(f.onset_t, f.fault_id) for f in self.engine if t >= f.onset_t]
        items += [(f.onset_t, f.fault_id) for f in self.sensors if t >= f.onset_t]
        return [fid for _, fid in sorted(items)]

    def state(self, t: float) -> dict:
        ids = self.active_ids(t)
        sev = [f.severity for f in self.engine if t >= f.onset_t] +               [f.severity for f in self.sensors if t >= f.onset_t]
        return {"active_faults": ids, "fault_label": "+".join(ids) if ids else "healthy",
                "severity": float(max(sev)) if sev else 0.0}
