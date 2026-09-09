# 24/7 Background Services (PC & Android Phone)

Dedicated background monitoring services for **Windows PC** and **Android Phone** that monitor the Rotax 915 iS digital twin continuously **without needing any web browser or terminal window open**.

---

## 🖥️ 1. Windows PC Background Service (`services/pc-agent/`)

The Windows agent runs completely invisibly in the background. It watches the twin server, displays native Windows Toast popups, and sounds hardware audio alarms on critical anomalies.

### Quick Commands (PowerShell / Command Prompt)

```powershell
cd services/pc-agent

# ── Start the agent invisibly right now (0 windows open) ──
.\start-silent.vbs

# ── Check agent status and recent logs ──
.\status.ps1

# ── Stop the agent ──
.\stop-agent.ps1

# ── Install to start automatically on Windows Boot/Logon ──
.\install-windows-service.ps1
```

### Features:
- **Zero Browser Required**: Operates purely as a Windows background process.
- **Native Toast Notifications**: Pops up in the Windows Notification Center and lock screen.
- **Hardware Audio Alarms**: Uses `winsound` to trigger aviation dual-tone master warnings (960Hz / 720Hz) through PC speakers.
- **Configurable**: Set `TWIN_SERVER_URL` in environment or edit `agent.py` to point to a remote server IP.

---

## 📱 2. Android Phone Background Sentinel (`services/android-agent/`)

Android puts apps to sleep when the screen locks. The Android Sentinel uses **CPU wake-lock** and **Termux:API** to ensure 24/7 uninterrupted monitoring on your phone.

### Quick Setup on Android:

1. Install **Termux** and **Termux:API** on your Android phone (free from F-Droid or Play Store).
2. Open Termux on your phone and run:
   ```bash
   pkg update -y && pkg install -y python termux-api
   ```
3. Copy `android_monitor.py` to your phone and launch it:
   ```bash
   export TWIN_SERVER_URL="http://<your-pc-ip>:4000"
   termux-wake-lock
   python android_monitor.py &
   ```

### Features:
- **Android CPU Wake-Lock**: Ensures the script stays alive even when the phone screen is locked and in your pocket for hours.
- **Lock-Screen Alerts**: Sends high-priority notifications with vibration patterns (`400,200,400,200,400`).
- **Voice TTS Announcements**: Uses Android Text-to-Speech to audibly announce faults (e.g. *"Warning: Engine UAV-01 Cylinder 3 CHT high"*).
- **Auto-Boot**: Automatically starts on phone restart if `Termux:Boot` is installed.

---

## 🔔 Zero-Install Mobile Alternative: ntfy Phone App

If you prefer not to use Termux on your phone, you can also use the free **ntfy app** on Android:
1. Install **ntfy** from Google Play or F-Droid.
2. Open settings and enable **"Persistent connection" (Foreground Service)**.
3. Subscribe to topic `sih-twin-alerts`.
4. Your phone now has a native persistent background daemon with a lock-screen status icon that wakes the phone with ringtones on engine alarms!
