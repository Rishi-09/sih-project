"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";
import { AlertPayload, TickFrame } from "./types";
import { playAviationAlarm, sendSystemNotification } from "./notifications";

export type RunStatus = "connecting" | "live" | "degraded" | "replay" | "stopped";

export interface TwinSocketState {
  latest: TickFrame | null;
  history: TickFrame[]; // capped ring buffer for sparklines/trend charts
  alerts: AlertPayload[];
  status: RunStatus;
}

const HISTORY_LIMIT = 300;

/** One socket per run, joins the `run:<id>` room and keeps a capped history
 * buffer for trend charts. Includes automatic lock-screen reconnection and
 * background audio/system alert dispatch when the device is locked or minimized. */
export function useTwinSocket(runId: string | null): TwinSocketState {
  const [state, setState] = useState<TwinSocketState>({ latest: null, history: [], alerts: [], status: "connecting" });
  const socketRef = useRef<Socket | null>(null);
  const knownAlertCodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!runId) return;
    setState({ latest: null, history: [], alerts: [], status: "connecting" });
    knownAlertCodesRef.current.clear();

    const socket = io(API_BASE, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("run:join", { runId });
    });

    socket.on("frame", (frame: TickFrame) => {
      if (frame.runId !== runId) return;

      // Check for new critical/warning alerts while device is locked or in background
      const currentCodes = new Set(frame.alerts.map((a) => a.code));
      for (const alert of frame.alerts) {
        if (!knownAlertCodesRef.current.has(alert.code)) {
          // Newly arrived alert
          if (alert.severity === "critical" || alert.severity === "caution") {
            playAviationAlarm(alert.severity === "critical" ? "critical" : "warning");

            // If phone/device is locked or browser tab is hidden, pop OS lock-screen notification
            if (typeof document !== "undefined" && document.hidden) {
              sendSystemNotification(
                `🚨 ${alert.severity.toUpperCase()} ALERT: ${alert.code}`,
                {
                  body: `${alert.message} | Channel: ${alert.channel} | EHI: ${Math.round(frame.health.ehi ?? 0)}%`,
                  tag: `alert-${alert.code}`,
                  url: window.location.href,
                  requireInteraction: true,
                }
              );
            }
          }
        }
      }
      knownAlertCodesRef.current = currentCodes;

      // Also trigger emergency notification if land_immediately or return_to_base recommended while hidden
      if (
        (frame.mission?.recommendation === "land_immediately" || frame.mission?.recommendation === "return_to_base") &&
        typeof document !== "undefined" &&
        document.hidden
      ) {
        const isLand = frame.mission.recommendation === "land_immediately";
        const primary = frame.mission.limiters[0]?.channel || "Exceeded limits";
        sendSystemNotification(isLand ? "🚨 EMERGENCY: LAND IMMEDIATELY" : "⚠️ MISSION ALERT: RETURN TO BASE", {
          body: `${frame.mission.reason} | Primary limiter: ${primary}.`,
          tag: "emergency-mission-verdict",
          url: window.location.href,
          requireInteraction: true,
        });
      }

      setState((prev) => {
        const history = [...prev.history, frame];
        if (history.length > HISTORY_LIMIT) history.shift();
        return { latest: frame, history, alerts: frame.alerts, status: prev.status === "connecting" ? "live" : prev.status };
      });
    });

    socket.on("run:status", ({ status }: { status: RunStatus }) => {
      setState((prev) => ({ ...prev, status }));
    });

    // Handle lock/unlock and network reconnection events:
    // When a phone or PC wakes from lock/sleep, immediately verify socket liveness
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && socketRef.current) {
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        } else {
          // Re-join room to ensure telemetry stream resumes without delay
          socketRef.current.emit("run:join", { runId });
        }
      }
    };

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("online", handleOnline);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("online", handleOnline);
      }
      socket.emit("run:leave", { runId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [runId]);

  return state;
}
