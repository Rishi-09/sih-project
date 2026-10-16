"""The vectorized nominal model must match retribution's NominalSensorModel exactly."""

import numpy as np

from twin2 import ensure_simulator_path

ensure_simulator_path()
from simulator.sensors import NominalSensorModel
from twin2.physics import HF_HEALTHY, SENSOR_CHANNELS, apply_health, nominal_targets

PHASES = ["STARTUP", "TAXI", "TAKEOFF", "CLIMB", "CRUISE", "LOITER", "DESCENT", "APPROACH", "SHUTDOWN"]


def test_nominal_parity():
    rng = np.random.default_rng(0)
    n = 2000
    thr = rng.uniform(0, 100, n)
    thr[:50] = 0.0
    thr[50:100] = rng.uniform(0, 4.9, 50)
    alt = rng.uniform(-100, 6500, n)
    oat = rng.uniform(-30, 48, n)
    ias = rng.uniform(0, 140, n)
    phase = rng.choice(PHASES, n)
    vec = nominal_targets(thr, alt, oat, ias, phase)
    ref_model = NominalSensorModel()
    for i in range(n):
        ref = ref_model.compute_nominal_targets(
            {"throttle_pct": thr[i], "alt_m": alt[i], "oat_c": oat[i], "ias_kt": ias[i], "phase": phase[i]})
        for ch in SENSOR_CHANNELS:
            assert abs(ref[ch] - vec[ch][i]) < 1e-9, (ch, i, ref[ch], vec[ch][i])


def test_healthy_factors_are_identity():
    thr = np.linspace(0, 100, 50)
    tgt = nominal_targets(thr, np.full(50, 3000.0), np.full(50, 5.0), np.full(50, 90.0), np.full(50, "CRUISE"))
    out = apply_health(tgt, thr, HF_HEALTHY)
    for ch in SENSOR_CHANNELS:
        np.testing.assert_allclose(out[ch], tgt[ch], atol=1e-9)


if __name__ == "__main__":
    test_nominal_parity()
    test_healthy_factors_are_identity()
    print("parity OK")
