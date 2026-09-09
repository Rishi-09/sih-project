#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Setup Script for Android Phone Background Sentinel
# Run inside Termux on Android: bash setup-android.sh
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "═════════════════════════════════════════════════════════════"
echo " Setting up Rotax 915 iS 24/7 Sentinel on Android Phone..."
echo "═════════════════════════════════════════════════════════════"

# 1. Install Python and Termux:API tools
pkg update -y
pkg install -y python termux-api

# 2. Acquire wake lock permission
termux-wake-lock

# 3. Create auto-boot directory (Termux:Boot support)
mkdir -p ~/.termux/boot
BOOT_SCRIPT="$HOME/.termux/boot/start-sentinel.sh"

cat << 'EOF' > "$BOOT_SCRIPT"
#!/bin/bash
termux-wake-lock
python ~/android_monitor.py > ~/sentinel.log 2>&1 &
EOF

chmod +x "$BOOT_SCRIPT"

echo "✅ Android phone environment ready!"
echo ""
echo "To launch the background sentinel right now:"
echo "  export TWIN_SERVER_URL=\"http://<your-server-ip>:4000\""
echo "  python android_monitor.py &"
echo ""
echo "The script will run 24/7 in the background with wake-lock."
echo "═════════════════════════════════════════════════════════════"
