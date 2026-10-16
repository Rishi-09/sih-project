import { EngineSummary } from "@/lib/types";
import { API_BASE } from "@/lib/api";
import { DashboardOverview } from "@/components/DashboardOverview";

async function getEngines(): Promise<EngineSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/engines`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return []; // server not running yet — render sample/empty state gracefully
  }
}

export default async function HomePage() {
  const engines = await getEngines();
  return (
    <main>
      <DashboardOverview initialEngines={engines} />
    </main>
  );
}
