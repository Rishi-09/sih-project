"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "./api";

/**
 * The engine the navigation should point at: the one currently being viewed if
 * the route names one, otherwise the fleet's most-degraded airframe.
 *
 * The rail used to link to a hardcoded `/uav/uav-01`, which is not an id the
 * backend issues — it mints cuids — so every Engine Console and 3D Twin link
 * landed on "Engine not found" against a real fleet. Only the dashboard worked,
 * because it linked with an id it had actually fetched.
 */
export function usePrimaryEngineId(): string | null {
  const pathname = usePathname();
  const fromPath = /^\/uav\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (fromPath) return;
    let cancelled = false;

    api
      .engines()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        const active = list.filter((e) => e.latestRunStatus === "live" || e.latestRunStatus === "degraded");
        const pool = active.length > 0 ? active : list;
        const pick = [...pool].sort((a, b) => (a.ehi ?? 101) - (b.ehi ?? 101))[0];
        setResolved(pick?.id ?? null);
      })
      .catch(() => {
        /* backend asleep — the links fall back to the fleet register */
      });

    return () => {
      cancelled = true;
    };
  }, [fromPath]);

  return fromPath ?? resolved;
}
