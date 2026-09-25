"use client";

import { useState } from "react";
import { MissionBlock, WhatIfResult } from "@/lib/types";
import { api } from "@/lib/api";

/**
 * "What does pulling power back actually buy us?"
 *
 * Kept out of the headline on purpose: it is a planning tool, not a status
 * readout, and mixing the two is what made the old panel hard to scan. It sits
 * next to the recommendation because when the engine advises a derate, this is
 * where an operator checks the trade before acting.
 *
 * The answer comes from the same Monte Carlo projection as the live advisory,
 * re-run with the remaining mission legs capped — so it reflects this engine's
 * own measured sensitivity to power, and correctly reports "no help" for a
 * fault that a derate genuinely cannot fix.
 */
function fmtDur(sec: number): string {
  if (sec <= 0) return "0m";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function WhatIfPlanner({ mission, runId }: { mission: MissionBlock; runId: string | null }) {
  const [power, setPower] = useState(mission.derateTo ?? 85);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function evaluate(pct: number) {
    if (!runId) return;
    setLoading(true);
    try {
      setResult(await api.whatif(runId, pct));
    } catch {
      // A planning aid failing must never disturb the live advisory above it.
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // A delta is only meaningful when BOTH the live assessment and the modelled
  // one exist; during warm-up neither does.
  const delta =
    result?.pSuccess !== null && result?.pSuccess !== undefined && mission.pSuccess !== null
      ? Math.round((result.pSuccess - mission.pSuccess) * 100)
      : null;

  return (
    <div className="whatif">
      <div className="whatif-row">
        <input
          type="range"
          min={50}
          max={100}
          step={5}
          value={power}
          onChange={(e) => setPower(Number(e.target.value))}
          onMouseUp={() => evaluate(power)}
          onTouchEnd={() => evaluate(power)}
          aria-label="Power setting to evaluate"
        />
        <span className="whatif-pct">{power}%</span>
      </div>
      {loading && <div className="whatif-out muted">calculating…</div>}
      {result && !loading && result.pSuccess === null && (
        <div className="whatif-out muted">Not assessed yet — the projection needs about a minute of telemetry.</div>
      )}
      {result && !loading && result.pSuccess !== null && (
        <div className="whatif-out">
          <strong>{Math.round(result.pSuccess * 100)}%</strong> success
          {delta !== null && delta !== 0 && (
            <span className={delta > 0 ? "delta-up" : "delta-down"}>
              {" "}
              {delta > 0 ? "+" : ""}
              {delta} pts
            </span>
          )}
          {delta === 0 && <span className="muted"> — no change</span>}
          {result.safeEnduranceSec !== null && (
            <span className="muted"> · {fmtDur(result.safeEnduranceSec)} safe endurance</span>
          )}
        </div>
      )}
      {!result && !loading && <div className="whatif-out muted">Drag to model a power setting.</div>}
    </div>
  );
}
