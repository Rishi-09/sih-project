"use client";

import { useState } from "react";
import { TickFrame } from "@/lib/types";
import { api } from "@/lib/api";

function fmtSec(s: number | null): string {
  if (s === null) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function PrognosisReliability({ frame, runId }: { frame: TickFrame | null; runId: string | null }) {
  const [derate, setDerate] = useState(100);
  const [whatif, setWhatif] = useState<{ pSuccess: number; safeEnduranceSec: number } | null>(null);
  const [loading, setLoading] = useState(false);

  if (!frame) return <p style={{ color: "var(--ink-3)" }}>No telemetry yet.</p>;
  const { prognosis, mission } = frame;

  async function runWhatif(pct: number) {
    if (!runId) return;
    setLoading(true);
    try {
      const result = await api.whatif(runId, pct);
      setWhatif(result);
    } catch {
      // silent — this is a nice-to-have slider, not core telemetry
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="kv-row">
        <span className="k">Remaining useful life</span>
        <span className="v">
          {fmtSec(prognosis.rulSec)}
          {prognosis.rulSec !== null && ` (${fmtSec(prognosis.rulLoSec)}–${fmtSec(prognosis.rulHiSec)})`}
        </span>
      </div>
      <div className="kv-row">
        <span className="k">P(mission success)</span>
        <span className="v">{Math.round(mission.pSuccess * 100)}%</span>
      </div>
      <div className="kv-row">
        <span className="k">Safe endurance</span>
        <span className="v">{fmtSec(mission.safeEnduranceSec)}</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <span className={`rec-pill rec-${mission.recommendation}`}>{mission.recommendation.replace(/_/g, " ")}</span>
      </div>

      <h2 style={{ marginTop: 18 }}>What-if: power derate</h2>
      <div className="slider-row">
        <input
          type="range"
          min={50}
          max={100}
          value={derate}
          onChange={(e) => setDerate(Number(e.target.value))}
          onMouseUp={() => runWhatif(derate)}
          onTouchEnd={() => runWhatif(derate)}
        />
        <span className="pct">{derate}%</span>
      </div>
      {loading && <div className="whatif-result">calculating…</div>}
      {whatif && !loading && (
        <div className="whatif-result">
          At {derate}% power → P(success) {Math.round(whatif.pSuccess * 100)}%, safe endurance {fmtSec(whatif.safeEnduranceSec)}
        </div>
      )}
    </div>
  );
}
