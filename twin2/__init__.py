"""
twin2 — physics-hybrid engine digital twin (DRDO plan Part B, extended to live use).

Models: M1 signal trust, M2 health factors, M4 cylinder split, M5 thermal
time-to-limit, M6 root cause, M7 survival, M8 mission advisor, plus L1
per-engine baseline and the S1-S3 self-reflection loop (ledger, debrief,
calibration). Reuses the Rotax 915 iS physics and limits in retribution/simulator.

Two ways in:
  fleet  python -m twin2.run / python -m twin2.api   (synthetic 20-engine fleet)
  live   twin2.live.LiveTwin, driven by retribution/server_ops at 20 Hz
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT_DIR = ROOT / "out"
RETRIBUTION = REPO / "retribution"


def ensure_simulator_path() -> None:
    """retribution/simulator is imported as the top-level package `simulator`."""
    p = str(RETRIBUTION)
    if p not in sys.path:
        sys.path.insert(0, p)


ensure_simulator_path()
