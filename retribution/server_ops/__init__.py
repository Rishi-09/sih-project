"""
Retribution: Engine Ops Server Package.
Live simulator + live physics twin (twin2) streamed over WebSocket to server/.
"""

import sys
from pathlib import Path

# twin2 (the engine model) lives at the repo root, next to retribution/.
_REPO = Path(__file__).resolve().parents[2]
if (_REPO / "twin2").is_dir() and str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))
