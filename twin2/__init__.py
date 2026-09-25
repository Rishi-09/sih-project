"""
twin2 — physics-hybrid engine digital twin (3-day prototype, DRDO plan Part B).

Models: M1 signal trust, M2 health factors, M4 cylinder split, M5 thermal
time-to-limit, M6 root cause, M7 survival, M8 mission advisor, plus L1
per-engine baseline and the S1-S3 self-reflection loop (ledger, debrief,
calibration). Reuses the Rotax 915 iS physics and limits in retribution/simulator.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT_DIR = ROOT / "out"

# retribution/simulator is imported as the top-level package `simulator`
_RETRIBUTION = str(REPO / "retribution")
if _RETRIBUTION not in sys.path:
    sys.path.insert(0, _RETRIBUTION)
