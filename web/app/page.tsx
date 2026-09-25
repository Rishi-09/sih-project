import { EngineSummary } from "@/lib/types";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import { FleetManager } from "@/components/FleetManager";

async function getEngines(): Promise<EngineSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/engines`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return []; // server not running yet — render empty state gracefully
  }
}

export default async function FleetPage() {
  const engines = await getEngines();
  return (
    <main className="fleet">
      <Link href="/twin2" style={{ display: "block", marginBottom: 20, padding: "10px 14px", border: "1px solid var(--accent)", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
        Fleet twin: health factors, diagnosis, survival and mission advisory (M1–M8) →
      </Link>
      <FleetManager initialEngines={engines} />
    </main>
  );
}
