FROM python:3.11-slim

WORKDIR /app

COPY requirements-server.txt ./
RUN pip install --no-cache-dir -r requirements-server.txt

COPY . ./

# Railway supplies PORT at runtime. The simulator accepts WebSocket clients on
# that port; it is intentionally not an HTTP health-check service.
CMD ["sh", "-c", "python run_ws_only.py --ws-port ${PORT:-8766}"]
