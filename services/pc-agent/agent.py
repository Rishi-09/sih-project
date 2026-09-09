#!/usr/bin/env python3
"""
Rotax 915 iS Digital Twin — Windows PC Background Service Agent

Runs invisibly 24/7 in the background on Windows PCs.
Monitors engine telemetry without needing any web browser open.
Triggers native Windows Toast notifications and audio alarms on critical events.
"""

import os
import sys
import time
import json
import logging
import threading
import subprocess
import urllib.request
import urllib.error

# Windows native sound library
try:
    import winsound
except ImportError:
    winsound = None

SERVER_URL = os.environ.get("TWIN_SERVER_URL", "http://localhost:4000").rstrip("/")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "2.0"))
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("TwinPCAgent")


def play_audio_alarm(is_critical: bool = True):
    """Play hardware sound alert in background thread."""
    def _play():
        if winsound:
            try:
                if is_critical:
                    # Dual-tone master warning: 960Hz and 720Hz
                    for _ in range(3):
                        winsound.Beep(960, 150)
                        winsound.Beep(720, 150)
                else:
                    winsound.Beep(600, 250)
            except Exception as e:
                logger.debug(f"Beep error: {e}")
                try:
                    winsound.PlaySound("SystemHand" if is_critical else "SystemExclamation", winsound.SND_ALIAS)
                except Exception:
                    pass

    t = threading.Thread(target=_play, daemon=True)
    t.start()


def show_windows_toast(title: str, message: str, is_critical: bool = True):
    """Show native Windows Toast Notification via PowerShell without external dependencies."""
    def _notify():
        ps_script = f"""
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlCommands, ContentType = WindowsRuntime] | Out-Null

        $template = @"
        <toast duration="{"long" if is_critical else "short"}">
            <visual>
                <binding template="ToastGeneric">
                    <text>{title}</text>
                    <text>{message}</text>
                </binding>
            </visual>
            <audio src="ms-winsoundevent:Notification.{"Looping.Alarm" if is_critical else "Default"}"/>
        </toast>
"@

        try {{
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $xml.LoadXml($template)
            $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Rotax 915 iS Sentinel").Show($toast)
        }} catch {{
            # Fallback for older PowerShell or constrained environments
            Add-Type -AssemblyName System.Windows.Forms
            $balloon = New-Object System.Windows.Forms.NotifyIcon
            $balloon.Icon = [System.Drawing.SystemIcons]::{"Error" if is_critical else "Warning"}
            $balloon.BalloonTipIcon = "{"Error" if is_critical else "Warning"}"
            $balloon.BalloonTipTitle = "{title}"
            $balloon.BalloonTipText = "{message}"
            $balloon.Visible = $true
            $balloon.ShowBalloonTip(8000)
        }}
        """

        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                timeout=10,
            )
        except Exception as e:
            logger.error(f"Failed to display Windows toast: {e}")

    t = threading.Thread(target=_notify, daemon=True)
    t.start()


class TwinPCAgent:
    def __init__(self):
        self.running = True
        self.seen_alerts = set()
        self.active_runs = set()
        self.last_emergency_time = 0

    def http_get(self, path: str):
        url = f"{SERVER_URL}{path}"
        req = urllib.request.Request(url, headers={"User-Agent": "TwinPCAgent/1.0"})
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

            # If runs changed
            for run_id, tail in current_live_runs:
                if (run_id, tail) not in self.active_runs:
                    logger.info(f"Detected new active sortie for {tail} (Run: {run_id[:8]})")
                    show_windows_toast(
                        f"✈ Sortie Live: {tail}",
                        f"Rotax 915 iS digital twin is active. Monitoring telemetry in background.",
                        is_critical=False,
                    )

                # Check alerts for this run
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
                                msg = a.get("message", "Threshold exceeded")
                                is_critical = severity == "critical"

                                logger.warning(f"ALERT [{tail}]: {code} ({severity}) - {msg}")
                                play_audio_alarm(is_critical=is_critical)
                                show_windows_toast(
                                    f"🚨 CRITICAL ALERT: {code} [{tail}]" if is_critical else f"⚠️ CAUTION: {code} [{tail}]",
                                    f"{msg} (Channel: {channel}). Check engine console.",
                                    is_critical=is_critical,
                                )
                except Exception as e:
                    logger.debug(f"Could not fetch alerts for {run_id}: {e}")

            self.active_runs = current_live_runs

        except urllib.error.URLError:
            # Server not running or unreachable
            pass
        except Exception as e:
            logger.debug(f"Poll cycle error: {e}")

    def run(self):
        logger.info(f"Rotax 915 iS Sentinel PC Agent starting...")
        logger.info(f"Target Twin Server: {SERVER_URL}")
        logger.info(f"Background monitoring active. Press Ctrl+C to stop.")

        show_windows_toast(
            "Twin Sentinel Active",
            f"Monitoring {SERVER_URL} in background. Alerts will notify on your lock screen/desktop.",
            is_critical=False,
        )

        while self.running:
            self.poll_cycle()
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    agent = TwinPCAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        logger.info("Agent stopped by user.")
