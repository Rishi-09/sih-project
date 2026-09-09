#!/usr/bin/env python3
"""
Test Utility for Rotax 915 iS Sentinel PC Background Service

Directly tests:
1. Native Windows Toast Notification (visible on desktop/lock screen)
2. Hardware Audio Warning Tone (Aviation dual-tone beep)
3. Twin Server connectivity (checks http://localhost:4000)
"""

import sys
import os

# Import notification and sound functions directly from agent
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent import show_windows_toast, play_audio_alarm, SERVER_URL, TwinPCAgent

print("=" * 60)
print(" Testing Rotax 915 iS PC Sentinel Alert System")
print("=" * 60)

# 1. Test Hardware Audio Alarm
print("\n[1/3] Testing PC Audio Alarm...")
print("  -> Playing aviation dual-tone master warning (960Hz / 720Hz)...")
play_audio_alarm(is_critical=True)
print("  [OK] Beep triggered through PC speakers.")

# 2. Test Native Windows Toast Notification
print("\n[2/3] Testing Native Windows Toast Notification...")
print("  -> Sending test notification to Windows Notification Center...")
show_windows_toast(
    "🚨 TEST: Rotax 915 iS Sentinel",
    "Sentinel is running! Alerts will appear on your lock screen even without a browser.",
    is_critical=True,
)
print("  [OK] Toast dispatched. Look at the bottom-right of your Windows screen!")

# 3. Test Twin Server Connection
print("\n[3/3] Checking Twin Server connection...")
agent = TwinPCAgent()
try:
    health = agent.http_get("/api/health")
    if health and health.get("ok"):
        print(f"  [OK] Twin Server is online at {SERVER_URL}")
        engines = agent.http_get("/api/engines")
        print(f"  [OK] Found {len(engines)} aircraft registered.")
        for e in engines:
            status = e.get("latestRunStatus") or "idle"
            print(f"       • {e.get('tail')}: {status}")
    else:
        print(f"  [!] Twin Server responded but not ok: {health}")
except Exception as e:
    print(f"  [!] Twin Server at {SERVER_URL} is currently stopped or offline.")
    print("      (Start the server with 'npm run dev' in server/ or 'docker compose up')")

print("\n" + "=" * 60)
print(" Test complete! Check your screen for the popup and sound.")
print("=" * 60)
