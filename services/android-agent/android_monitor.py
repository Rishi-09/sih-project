#!/usr/bin/env python3
"""
Rotax 915 iS Digital Twin — Android Phone 24/7 Background Sentinel Daemon

Runs continuously in the background on Android devices (via Termux / Pydroid).
Maintains CPU wake-lock so Android does not kill the process when the screen locks.
Fires native Android lock-screen notifications, vibration patterns, and optional
voice (TTS) audio announcements for critical telemetry alarms.
"""

import os
import sys
import time
import json
import shutil
import logging
import subprocess
import urllib.request
import urllib.error

SERVER_URL = os.environ.get("TWIN_SERVER_URL", "http://192.168.1.100:4000").rstrip("/")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "3.0"))
ENABLE_TTS = os.environ.get("ENABLE_TTS", "true").lower() in ("1", "true", "yes")
ENABLE_VIBRATE = os.environ.get("ENABLE_VIBRATE", "true").lower() in ("1", "true", "yes")

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "android_sentinel.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("AndroidSentinel")

# Check if termux-api commands are available
HAS_TERMUX_API = shutil.which("termux-notification") is not None


def acquire_android_wake_lock():
    """Prevent Android OS from sleeping CPU when screen is turned off."""
    if shutil.which("termux-wake-lock"):
        try:
            subprocess.run(["termux-wake-lock"], check=True)
            logger.info("Android CPU wake-lock acquired (background execution guaranteed).")
        except Exception as e:
            logger.warning(f"Could not acquire termux wake-lock: {e}")


def release_android_wake_lock():
    """Release wake-lock on exit."""
    if shutil.which("termux-wake-unlock"):
        try:
            subprocess.run(["termux-wake-unlock"], check=True)
            logger.info("Android CPU wake-lock released.")
        except Exception:
            pass


def send_android_notification(title: str, content: str, is_critical: bool = True, tag: str = "engine-alert"):
    """Show high-priority notification on Android lock screen with vibration and LED."""
    if HAS_TERMUX_API:
        try:
            cmd = [
                "termux-notification",
                "--title", title,
                "--content", content,
                "--id", tag,
                "--priority", "high" if is_critical else "default",
                "--ongoing" if not is_critical and tag == "sentinel-status" else "--alert-once",
            ]
            if ENABLE_VIBRATE and is_critical:
                cmd.extend(["--vibrate", "400,200,400,200,400"])
                cmd.extend(["--sound"])

            subprocess.run(cmd, timeout=5)
        except Exception as e:
            logger.debug(f"termux-notification failed: {e}")

    # Voice TTS readout for critical warnings
    if is_critical and ENABLE_TTS and shutil.which("termux-tts-speak"):
        try:
            clean_speech = f"Attention: {title}. {content}"
            subprocess.run(["termux-tts-speak", "-r", "1.1", clean_speech], timeout=8)
        except Exception:
            pass


class AndroidSentinelDaemon:
    def __init__(self):
        self.running = True
        self.seen_alerts = set()
        self.active_runs = set()

    def http_get(self, path: str):
        url = f"{SERVER_URL}{path}"
        req = urllib.request.Request(url, headers={"User-Agent": "AndroidSentinel/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
        return None

    def poll_cycle(self):
        try:
            engines = self.http_get("/api/engines")
            if not engines or not isinstance(engines, list):
                return

            current_live_runs = set()

            for engine in engines:
                tail = engine.get("tail", "UAV")
                latest_run_id = engine.get("latestRunId")
                status = engine.get("latestRunStatus")

                if latest_run_id and status in ("live", "degraded"):
                    current_live_runs.add((latest_run_id, tail))

            # New sorties started
            for run_id, tail in current_live_runs:
                if (run_id, tail) not in self.active_runs:
                    logger.info(f"✈ Live sortie detected for {tail} ({run_id[:8]})")
                    send_android_notification(
                        f"✈ Sortie Active: {tail}",
                        "Twin Sentinel monitoring engine telemetry in background.",
                        is_critical=False,
                        tag="sentinel-status",
                    )

                # Fetch and evaluate alerts for this run
                try:
                    alerts = self.http_get(f"/api/runs/{run_id}/alerts")
                    if alerts and isinstance(alerts, list):
                        for a in alerts:
                            alert_id = a.get("id") or f"{run_id}:{a.get('code')}:{a.get('t')}"
                            if alert_id not in self.seen_alerts and not a.get("clearedAtT"):
                                self.seen_alerts.add(alert_id)
                                severity = a.get("severity", "caution")
                                code = a.get("code", "ALERT")
                                channel = a.get("channel", "engine")
                                msg = a.get("message", "Threshold breach")
                                is_critical = severity == "critical"

                                logger.warning(f"ANDROID ALERT [{tail}]: {code} ({severity}) - {msg}")
                                send_android_notification(
                                    f"🚨 CRITICAL: {code} [{tail}]" if is_critical else f"⚠️ CAUTION: {code} [{tail}]",
                                    f"{msg} (Channel: {channel}).",
                                    is_critical=is_critical,
                                    tag=f"alert-{code}",
                                )
                except Exception as e:
                    logger.debug(f"Alert fetch error: {e}")

            self.active_runs = current_live_runs

        except urllib.error.URLError:
            pass
        except Exception as e:
            logger.debug(f"Poll error: {e}")

    def run(self):
        acquire_android_wake_lock()
        logger.info(f"Android Twin Sentinel started 24/7 background service.")
        logger.info(f"Target Server: {SERVER_URL}")

        send_android_notification(
            "Twin Sentinel Connected",
            f"Monitoring {SERVER_URL} 24/7. Phone will alert when screen is locked.",
            is_critical=False,
            tag="sentinel-status",
        )

        try:
            while self.running:
                self.poll_cycle()
                time.sleep(POLL_INTERVAL)
        finally:
            release_android_wake_lock()


if __name__ == "__main__":
    daemon = AndroidSentinelDaemon()
    try:
        daemon.run()
    except KeyboardInterrupt:
        logger.info("Android Sentinel stopped.")
