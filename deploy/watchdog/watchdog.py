#!/usr/bin/env python3
"""
Watchdog — lightweight health monitor for the self-hosted twin stack.

Checks each service at a fixed interval and sends a webhook alert to your
phone (Discord, Telegram, Slack, or any URL) when something goes down or
comes back up.

Environment variables:
  CHECK_INTERVAL    Seconds between health checks (default: 30)
  SERVER_URL        URL to ping for the Node.js server (default: http://server:4000/api/health)
  WEB_URL           URL to ping for the Next.js web (default: http://web:3000)
  ALERT_WEBHOOK_URL Webhook URL to POST alerts to (optional)
"""

import os
import time
import json
import urllib.request
import urllib.error
from datetime import datetime

CHECK_INTERVAL = int(os.environ.get("CHECK_INTERVAL", "30"))
SERVICES = {
    "twin-server": os.environ.get("SERVER_URL", "http://server:4000/api/health"),
    "web-frontend": os.environ.get("WEB_URL", "http://web:3000"),
}
WEBHOOK_URL = os.environ.get("ALERT_WEBHOOK_URL", "").strip()

# Track previous state so we only alert on transitions (down→up, up→down)
prev_state: dict[str, bool] = {}


def check_service(name: str, url: str) -> bool:
    """Returns True if the service responds with HTTP 2xx within 5 seconds."""
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "sih-twin-alerts").strip()

def send_alert(message: str, is_down: bool = True):
    """POST alert to phone via ntfy.sh and configured webhook URL."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    full_message = f"[{now}] {message}"

    # 1. ntfy.sh push notification (reaches phone lock screens even when locked/asleep)
    if NTFY_TOPIC:
        try:
            req = urllib.request.Request(
                f"https://ntfy.sh/{NTFY_TOPIC}",
                data=full_message.encode("utf-8"),
                headers={
                    "Title": "🚨 SYSTEM HEALTH WATCHDOG" if is_down else "✅ SYSTEM RECOVERED",
                    "Priority": "urgent" if is_down else "default",
                    "Tags": "rotating_light,fire" if is_down else "white_check_mark,green_heart",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                pass
        except Exception as e:
            print(f"[watchdog] ntfy push error: {e}")

    # 2. Webhook (Discord / Slack / Telegram)
    if not WEBHOOK_URL:
        return

    # Try Discord-style payload first, fall back to plain JSON
    for payload in [
        {"content": full_message},                             # Discord / Slack
        {"text": full_message},                                # Slack alternative
        {"message": full_message},                             # Generic
    ]:
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                WEBHOOK_URL,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if 200 <= resp.status < 300:
                    return
        except Exception:
            continue

    print(f"[watchdog] Failed to send alert to webhook: {full_message}")


def main():
    print(f"[watchdog] Starting health monitor (interval={CHECK_INTERVAL}s)")
    print(f"[watchdog] Monitoring: {', '.join(SERVICES.keys())}")
    if WEBHOOK_URL:
        print(f"[watchdog] Alerts → {WEBHOOK_URL[:60]}...")
    else:
        print("[watchdog] No ALERT_WEBHOOK_URL set — alerts will only print to stdout")

    while True:
        for name, url in SERVICES.items():
            healthy = check_service(name, url)
            was_healthy = prev_state.get(name)

            if was_healthy is None:
                # First check — establish baseline
                status = "✅ UP" if healthy else "❌ DOWN"
                print(f"[watchdog] {name}: {status}")
                if not healthy:
                    send_alert(f"🚨 {name} is DOWN on startup ({url})", is_down=True)
            elif was_healthy and not healthy:
                # Transition: UP → DOWN
                print(f"[watchdog] ❌ {name} went DOWN")
                send_alert(f"🚨 {name} is DOWN! ({url}) — Docker will auto-restart it.", is_down=True)
            elif not was_healthy and healthy:
                # Transition: DOWN → UP (recovered)
                print(f"[watchdog] ✅ {name} recovered")
                send_alert(f"✅ {name} is back UP ({url})", is_down=False)

            prev_state[name] = healthy

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
