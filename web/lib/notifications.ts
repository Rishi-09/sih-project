"use client";

let wakeLockSentinel: any = null;
let audioCtx: AudioContext | null = null;

/**
 * Register Service Worker for PWA support and background lock-screen notifications.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch (err) {
    console.warn("ServiceWorker registration failed:", err);
    return null;
  }
}

/**
 * Request OS Notification permission for phone & PC lock screens.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "granted") return "granted";
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch {
    return "denied";
  }
}

/**
 * Check current notification permission status.
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  return Notification.permission;
}

/**
 * Send an OS-level notification that displays on Phone Lock Screen or PC Notification Center.
 */
export async function sendSystemNotification(
  title: string,
  options: {
    body: string;
    tag?: string;
    url?: string;
    requireInteraction?: boolean;
  }
) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notifOptions: Record<string, any> = {
    body: options.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: options.tag || "engine-telemetry",
    requireInteraction: options.requireInteraction ?? true,
    // Vibration pattern: buzz-pause-buzz-pause-buzz (supported on Android)
    vibrate: [250, 100, 250, 100, 250],
    data: { url: options.url || window.location.href },
  };

  // Try Service Worker registration first (better for lock screen delivery)
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && "showNotification" in reg) {
        await reg.showNotification(title, notifOptions);
        return;
      }
    } catch {
      // fallback to new Notification()
    }
  }

  try {
    new Notification(title, notifOptions);
  } catch (e) {
    console.warn("Could not display notification:", e);
  }
}

/**
 * Synthesize an aviation Master Warning alert sound using Web Audio API.
 * Works natively in any modern browser without downloading audio files.
 */
export function playAviationAlarm(type: "critical" | "warning" = "critical") {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "critical") {
      // Aviation two-tone Master Warning: 960Hz / 720Hz alternating warble
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(960, now);
      osc.frequency.setValueAtTime(720, now + 0.15);
      osc.frequency.setValueAtTime(960, now + 0.3);
      osc.frequency.setValueAtTime(720, now + 0.45);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else {
      // Caution Chime: 540Hz gentle ping
      osc.type = "sine";
      osc.frequency.setValueAtTime(540, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch (err) {
    console.warn("Audio alarm playback error:", err);
  }
}

/**
 * Acquire Screen Wake Lock to prevent phone/tablet or PC from going to sleep or locking.
 */
export async function acquireWakeLock(): Promise<boolean> {
  if (typeof window === "undefined" || !("wakeLock" in navigator)) return false;
  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (err) {
    console.warn("Wake lock request failed:", err);
    return false;
  }
}

/**
 * Release Screen Wake Lock.
 */
export async function releaseWakeLock(): Promise<void> {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    }
    wakeLockSentinel = null;
  }
}

/**
 * Check if Screen Wake Lock is currently active.
 */
export function isWakeLockActive(): boolean {
  return Boolean(wakeLockSentinel);
}
