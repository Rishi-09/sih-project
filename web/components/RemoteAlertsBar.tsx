"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  acquireWakeLock,
  releaseWakeLock,
  isWakeLockActive,
  getNotificationPermission,
  requestNotificationPermission,
  playAviationAlarm,
} from "@/lib/notifications";

export function RemoteAlertsBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [topic, setTopic] = useState("sih-twin-alerts");
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission>("default");
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    // Load config from server
    api
      .getNotificationsConfig()
      .then((cfg) => {
        setTopic(cfg.topic || "sih-twin-alerts");
        setWebhookConfigured(cfg.webhookConfigured);
      })
      .catch(() => {});

    setBrowserPerm(getNotificationPermission());
    setWakeLockOn(isWakeLockActive());
  }, []);

  const handleToggleWakeLock = async () => {
    if (wakeLockOn) {
      await releaseWakeLock();
      setWakeLockOn(false);
    } else {
      const ok = await acquireWakeLock();
      setWakeLockOn(ok);
    }
  };

  const handleRequestBrowserPerm = async () => {
    const perm = await requestNotificationPermission();
    setBrowserPerm(perm);
  };

  const handleSendTest = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      const res = await api.testNotification(topic);
      if (res.success) {
        setTestStatus("✅ Test alert sent! Check your phone lock screen.");
      } else {
        setTestStatus("⚠️ Alert dispatched to topic: " + res.topic);
      }
    } catch (err: any) {
      setTestStatus("❌ Failed to send: " + (err.message || "Network error"));
    } finally {
      setIsTesting(false);
      setTimeout(() => setTestStatus(null), 7000);
    }
  };

  const handleUpdateTopic = async (newTopic: string) => {
    setTopic(newTopic);
    try {
      await api.updateNotificationsConfig({ topic: newTopic });
    } catch {}
  };

  const ntfyUrl = `https://ntfy.sh/${encodeURIComponent(topic)}`;

  return (
    <div className="remote-alerts-container">
      <div className="remote-alerts-banner">
        <div className="banner-left">
          <span className="live-pulse" />
          <span className="banner-title">
            <strong>24/7 Phone & Lock-Screen Support</strong>
          </span>
          <span className="banner-badge">
            Lock-Screen Push: <code className="mono">{topic}</code>
          </span>
          {wakeLockOn && <span className="banner-badge badge-ok">☀️ Screen Awake</span>}
          {browserPerm === "granted" && <span className="banner-badge badge-ok">🔔 OS Alerts Ready</span>}
        </div>
        <div className="banner-right">
          <button
            type="button"
            className="btn btn-sm btn-action"
            onClick={handleSendTest}
            disabled={isTesting}
            title="Send an instant test alert to verify your phone or PC lock-screen rings"
          >
            {isTesting ? "Sending…" : "🧪 Test Phone Alert"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? "Hide Controls ▲" : "Device Setup ▼"}
          </button>
        </div>
      </div>

      {testStatus && <div className="test-alert-notice">{testStatus}</div>}

      {isOpen && (
        <div className="remote-alerts-drawer">
          <div className="drawer-grid">
            {/* 1. Phone Lock-Screen Push (ntfy) */}
            <div className="drawer-card">
              <div className="card-header">
                <span className="card-icon">📱</span>
                <h4>Phone Lock-Screen Push (Works When Locked / Asleep)</h4>
              </div>
              <p className="card-desc">
                Receive instant engine alarms on your phone’s lock screen with sound and vibration even when your phone is locked, in your pocket, or you are using other apps.
              </p>
              <div className="topic-row">
                <label>Alert Topic:</label>
                <input
                  type="text"
                  className="input-topic"
                  value={topic}
                  onChange={(e) => handleUpdateTopic(e.target.value)}
                  placeholder="e.g. sih-twin-alerts"
                />
              </div>
              <div className="action-row">
                <a
                  href={ntfyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                  title="Open on phone or subscribe to notifications"
                >
                  📲 Subscribe on Phone (Web / App) ↗
                </a>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleSendTest}
                  disabled={isTesting}
                >
                  🔔 Ping Phone Now
                </button>
              </div>
              <div className="card-hint">
                Tip: Install the free <strong>ntfy app</strong> on iOS or Android and subscribe to <code>{topic}</code> for native lock-screen ringing.
              </div>
            </div>

            {/* 2. Browser & PC Lock-Screen Notifications */}
            <div className="drawer-card">
              <div className="card-header">
                <span className="card-icon">🔔</span>
                <h4>Browser & PC Lock-Screen Alerts</h4>
              </div>
              <p className="card-desc">
                Shows system notifications in Windows Action Center, Mac Notification Center, or mobile browser when an engine anomaly occurs.
              </p>
              <div className="status-row">
                <span>Permission:</span>
                <span className={`perm-status perm-${browserPerm}`}>
                  {browserPerm === "granted" ? "✅ Enabled" : browserPerm === "denied" ? "❌ Blocked in Browser" : "⚠️ Needs Permission"}
                </span>
              </div>
              {browserPerm !== "granted" ? (
                <button
                  type="button"
                  className="btn btn-action btn-sm"
                  onClick={handleRequestBrowserPerm}
                >
                  Enable OS Notifications
                </button>
              ) : (
                <div className="perm-ok-badge">Lock-screen notifications active on this device</div>
              )}
              <div className="audio-test-row">
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => playAviationAlarm("critical")}
                >
                  🔊 Test Master Warning Alarm
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => playAviationAlarm("warning")}
                >
                  🔉 Test Caution Chime
                </button>
              </div>
            </div>

            {/* 3. Screen Keep-Awake (Wake Lock) */}
            <div className="drawer-card">
              <div className="card-header">
                <span className="card-icon">☀️</span>
                <h4>Screen Keep-Awake (Wake Lock)</h4>
              </div>
              <p className="card-desc">
                Prevents your phone, tablet, or laptop from dimming or locking the screen while actively monitoring a mission sortie.
              </p>
              <div className="wakelock-row">
                <button
                  type="button"
                  className={`btn btn-sm ${wakeLockOn ? "btn-ok" : "btn-secondary"}`}
                  onClick={handleToggleWakeLock}
                >
                  {wakeLockOn ? "☀️ Screen Keep-Awake: ACTIVE" : "🌙 Screen Keep-Awake: OFF"}
                </button>
                <span className="wakelock-hint">
                  {wakeLockOn
                    ? "Your screen will not turn off automatically."
                    : "Screen will lock normally according to device settings."}
                </span>
              </div>
              {webhookConfigured && (
                <div className="webhook-badge">
                  ✅ Team Webhook (Discord / Slack) is configured on the server
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
