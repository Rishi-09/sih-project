# Live simulator + live physics twin. Build from the REPO ROOT, because the model
# (twin2/) lives next to retribution/, not inside it:
#
#   docker build -f retribution/Dockerfile -t retribution-ops .
#
# On Railway: set the service's root directory to the repo root and its
# Dockerfile path to retribution/Dockerfile.
FROM python:3.11-slim

WORKDIR /app

COPY retribution/requirements-server.txt ./
RUN pip install --no-cache-dir -r requirements-server.txt

COPY twin2/ ./twin2/
COPY retribution/ ./retribution/

WORKDIR /app/retribution

# Railway supplies PORT at runtime. The simulator accepts WebSocket clients on
# that port; it is intentionally not an HTTP health-check service.
CMD ["sh", "-c", "python run_ws_only.py --ws-port ${PORT:-8766}"]
