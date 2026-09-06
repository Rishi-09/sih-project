# UAV Engine Digital Twin & Predictive Health Monitoring

A real-time digital twin and predictive maintenance platform for a Rotax 915 iS / 914 series UAV piston engine. A physics-based simulator streams live telemetry over WebSockets, a physics-informed ML pipeline turns that telemetry into explainable health scores and fault diagnoses, and a Next.js dashboard visualizes the fleet, a live 3D engine twin, alerts, and AI-assisted diagnosis in real time.

## What it does

- **Simulates** a turbocharged 4-cylinder UAV engine (`retribution/simulator`) with realistic thermal, aerodynamic, and sensor-noise physics, including injectable single/compound faults.
- **Streams** 1 Hz telemetry over WebSockets from the simulator/ops engine (`retribution/server_ops`) to the backend.
- **Diagnoses** engine health via a three-model ML pipeline (`ML/`):
  1. **Nominal Digital Twin** — 19 gradient-boosted regressors predict expected healthy sensor values from flight context.
  2. **Fault Classifier** — a 91-class gradient-boosted classifier identifies healthy/single/compound/triple-fault states from 76 rolling residual features.
  3. **Anomaly Detector** — an Isolation Forest flags novel, unmodeled anomalies with an ultra-low false-alarm rate.
  
  Together these produce 0–100 subsystem health scores, deterministic explanations, and Remaining Useful Life (RUL) prognosis. See [ML/README.md](ML/README.md) and [ML/context.md](ML/context.md) for the full technical writeup.
- **Serves** the twin state, run history, alerts, and AI advisory chat via an Express + Socket.IO + Prisma backend (`server/`).
- **Visualizes** the fleet, a live 3D engine model, sensor grid, alerts, diagnosis, and prognosis/reliability panels in a Next.js dashboard (`web/`).
- **Shares** a single TypeScript contract (`contract/`) defining the telemetry/health frame shape that both `server` and `web` agree on.

## Architecture

```
retribution/ (Python)                server/ (Node/Express)          web/ (Next.js)
┌─────────────────────┐   WS/HTTP    ┌───────────────────────┐  HTTP/WS  ┌──────────────────────┐
│ simulator/           │─────────────▶│ ws/ gateway            │──────────▶│ Fleet + UAV dashboard │
│  physics + faults    │              │ routes/ engines, runs   │           │ Sensor grid, alerts   │
│ server_ops/          │              │ ai/ Groq-backed advisor │           │ 3D engine twin        │
│  WS/HTTP ops server   │              │ db/ Prisma (SQLite)     │           │ AI panel, prognosis   │
│ pure_engine_ml.py     │              └───────────────────────┘           └──────────────────────┘
└─────────────────────┘
          ▲
          │ inference
┌─────────┴─────────┐
│ ML/                │  Nominal Twin → Residual Z-Scores → 76 Features → Fault Classifier + Anomaly Detector → Health/RUL
└────────────────────┘

contract/  — shared TickFrame / HealthBlock types used by server + web (kept in sync manually)
tools/     — asset pipeline (e.g. rebuilding the 3D engine model from FBX)
```

## Repository layout

| Path | Description |
|---|---|
| [`web/`](web/) | Next.js 16 + React 19 dashboard — fleet view, per-UAV page, 3D twin (Three.js), sensor grid, alerts, AI panel, prognosis/reliability. |
| [`server/`](server/) | Express + Socket.IO backend — REST API for engines/runs, WebSocket gateway for live frames, Prisma/SQLite persistence, Groq-backed AI advisory with an offline fallback. |
| [`ML/`](ML/) | Machine learning subsystem — nominal digital twin, fault classifier, anomaly detector, feature engineering, health index & RUL prognosis, trained model artifacts. |
| [`retribution/`](retribution/) | Python engine physics simulator, fault injection, and the ops WebSocket/HTTP server that streams simulated telemetry. |
| [`contract/`](contract/) | Shared TypeScript contract (`types.ts`) plus sensor/fault reference JSON, defining the wire format consumed by `server` and `web`. |
| [`tools/`](tools/) | Utility scripts, e.g. rebuilding the compressed 3D engine model used by the web twin. |

## Getting started

### Prerequisites
- Node.js (for `web/` and `server/`)
- Python >= 3.10 (for `ML/` and `retribution/`)

### Backend (`server/`)
```bash
cd server
npm install
cp .env.example .env        # optional — works with SQLite + offline AI fallback by default
npm run prisma:migrate
npm run seed                # optional: seed sample engines
npm run dev                 # starts on :4000
```

### Frontend (`web/`)
```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev                 # starts on :3000
```

### Simulator / ops server (`retribution/`)
```bash
cd retribution
pip install -r requirements-server.txt
python run_ws_only.py
```

### ML pipeline (`ML/`)
See [ML/README.md](ML/README.md) for setup, dependencies, and reproduction commands. Example inference:
```python
import pandas as pd
from src.inference import predict

df = pd.read_parquet("data/runs_v3/flight_0001.parquet").iloc[:60]
result = predict(df)
print(result["health_score"], result["fault_type"])
```

## Notes

- The shared contract in `contract/types.ts` is duplicated into `server/src/types.ts` and `web/lib/types.ts` (not imported via a workspace) so each project stays independently runnable — keep all three in sync when the shape changes, and bump `CONTRACT_VERSION`.
- The backend runs with zero configuration (SQLite + an offline canned AI advisory); set `GROQ_API_KEY` in `server/.env` to enable live AI responses.
