import { EngineSummary } from "@/lib/types";
import { API_BASE } from "@/lib/api";
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
      <FleetManager initialEngines={engines} />
    </main>
  );
}
