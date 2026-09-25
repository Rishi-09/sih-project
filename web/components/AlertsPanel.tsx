"use client";

import { AlertPayload } from "@/lib/types";

export function AlertsPanel({ alerts }: { alerts: AlertPayload[] }) {
  if (alerts.length === 0) return <div className="alert-empty">No open alerts.</div>;
  return (
    <div>
      {alerts.map((a) => (
        <div className={`alert-item alert-${a.severity}`} key={a.code}>
          <span className="alert-dot" />
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}
