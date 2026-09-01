import Link from "next/link";
import { EngineSummary } from "@/lib/types";
import { API_BASE } from "@/lib/api";

async function getEngines(): Promise<EngineSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/engines`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return []; // server not running yet — render an empty fleet rather than crashing
  }
}

export default async function FleetPage() {
  const engines = await getEngines();
  return (
    <main className="fleet">
      <h1>Fleet — Rotax 915 iS</h1>
      {engines.length === 0 ? (
        <p style={{ color: "var(--ink-3)" }}>
          No engines found. Is the backend running on {API_BASE}? Run <code>npm run seed</code> in <code>server/</code> if it's up but empty.
        </p>
      ) : (
        <div className="fleet-grid">
          {engines.map((e) => (
            <Link key={e.id} href={`/uav/${e.id}`} className="fleet-card">
              <div className="tail">{e.tail}</div>
              <div className="model">{e.model}</div>
              <div className="ehi">{e.ehi !== null ? `EHI ${e.ehi}/100` : "No active run"}</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                <span className={`status status-${e.latestRunStatus ?? "idle"}`}>{e.latestRunStatus ?? "idle"}</span>
                <span style={{ fontSize: "11px", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>3D Twin ◈</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
