"""
Minimal launcher for sih_project's integration: starts only the Engine Ops
WebSocket server (sim + ML), no HTTP static file server. We don't use
Retribution's own HTML/JS frontend (engine_ops/, not copied here) — our
Next.js console (web/) is the UI. Node's server connects to this WS feed
and re-broadcasts through our own contract.

Adapted from run_engine_ops.py in the source repo — same OpsSimulationManager
and OpsWSServer, just without OpsHTTPServer/webbrowser.
"""

import argparse
import asyncio
import logging
import os
import sys

from server_ops.config import OPS_WS_PORT, DEFAULT_SPEED_MULTIPLIER
from server_ops.ops_loop import OpsSimulationManager
from server_ops.ops_ws_server import OpsWSServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("EngineOpsWSOnly")


def parse_args():
    parser = argparse.ArgumentParser(description="Retribution Engine Ops — WebSocket-only launcher")
    parser.add_argument("--ws-port", type=int, default=int(os.environ.get("PORT", OPS_WS_PORT)))
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED_MULTIPLIER)
    parser.add_argument("--no-ml", action="store_true", help="Disable ML pipeline")
    return parser.parse_args()


async def main():
    args = parse_args()
    logger.info("=== Retribution Engine Ops — WS-only mode (sih_project integration) ===")

    sim_manager = OpsSimulationManager()
    if not args.no_ml:
        sim_manager.initialize_ml()
    else:
        logger.info("Running in --no-ml mode.")

    sim_manager.start(speed=args.speed)

    ws_server = OpsWSServer(sim_manager, host="0.0.0.0", port=args.ws_port)
    ws_service = await ws_server.start()

    logger.info(f"WebSocket stream: ws://localhost:{args.ws_port}")
    logger.info(f"Pacing: 20 Hz inner loop ({args.speed}x speed)")

    try:
        while True:
            await asyncio.sleep(1.0)
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Shutting down...")
    finally:
        sim_manager.is_running = False
        ws_service.close()
        await ws_service.wait_closed()
        logger.info("Cleanly shut down.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
