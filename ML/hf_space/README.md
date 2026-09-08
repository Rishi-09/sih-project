---
title: R2 UAV Engine ML Service
emoji: 🛩️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
---

# R2 UAV Engine Health Monitoring ML Inference Service

Free-tier microservice for real-time inference on 19-channel aircraft piston engine telemetry, deployed on Hugging Face Spaces using the **Gradio SDK** (100% Free CPU Basic tier — no paid Docker or credit card required).

FastAPI routes are mounted alongside Gradio so both the interactive web UI and JSON REST endpoints work simultaneously.

## Endpoints

- `GET /health` — Health check & keep-alive target (pinged every 24h by Railway to prevent sleeping)
- `GET /schema` — Lists required context and sensor channels
- `POST /predict` — Accepts 60-second telemetry window, returns health index (0-100), 91-class fault diagnosis, anomaly flag, and RUL prognosis.

## Free Deployment to Hugging Face Spaces

1. Go to **[Hugging Face — New Space](https://huggingface.co/new-space)**
   - **Space name**: e.g. `r2-engine-ml`
   - **Space SDK**: Select **Gradio** *(Free tier: CPU basic · 2 vCPU · 16 GB RAM)* — **Do NOT select Docker (Docker is paid)**
   - **Visibility**: Public (or Private)

2. Clone the Space repository locally:
   ```bash
   git clone https://huggingface.co/spaces/<your-username>/r2-engine-ml
   ```

3. Copy the following files from this `ML/` directory into your cloned Space folder:
   - `app.py`
   - `engine_pipeline.py`
   - `requirements.txt`
   - `README.md` (this file, including the frontmatter at the top)
   - `models/` directory (containing all `.joblib` files)
   - `data/` directory

4. Push to Hugging Face:
   ```bash
   git add .
   git commit -m "Deploy R2 Engine ML service on free Gradio SDK"
   git push
   ```

5. Hugging Face will automatically install `requirements.txt` and launch `app.py` on the free CPU tier.

6. Your Space URL will be:
   ```
   https://<your-username>-r2-engine-ml.hf.space
   ```

7. Update `ML_API_URL` in your Railway backend `.env`:
   ```env
   ML_API_URL=https://<your-username>-r2-engine-ml.hf.space
   ```
