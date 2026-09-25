"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE } from "./api";
import { AlertPayload, TickFrame } from "./types";

export type RunStatus = "connecting" | "live" | "degraded" | "replay" | "stopped";

export interface TwinSocketState {
  latest: TickFrame | null;
  history: TickFrame[]; // capped ring buffer for sparklines/trend charts
  alerts: AlertPayload[];
  status: RunStatus;
}

const HISTORY_LIMIT = 300;

/** One socket per run, joins the `run:<id>` room and keeps a capped history
 * buffer for trend charts. See published plan §B5/§B6. */
export function useTwinSocket(runId: string | null): TwinSocketState {
  const [state, setState] = useState<TwinSocketState>({ latest: null, history: [], alerts: [], status: "connecting" });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!runId) return;
    setState({ latest: null, history: [], alerts: [], status: "connecting" });

    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("run:join", { runId }));

    socket.on("frame", (frame: TickFrame) => {
      if (frame.runId !== runId) return;
      setState((prev) => {
        const history = [...prev.history, frame];
        if (history.length > HISTORY_LIMIT) history.shift();
        return { latest: frame, history, alerts: frame.alerts, status: prev.status === "connecting" ? "live" : prev.status };
      });
    });

    socket.on("run:status", ({ status }: { status: RunStatus }) => {
      setState((prev) => ({ ...prev, status }));
    });

    return () => {
      socket.emit("run:leave", { runId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [runId]);

  return state;
}
