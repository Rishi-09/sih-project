"use client";

import { MissionBlock } from "@/lib/types";

/**
 * The console's headline. Answers one question — can this sortie finish? — in
 * the order an operator needs it: the ACTION first, the confidence in it
 * second, the evidence third.
 *
 * The old console led with 19 sensor tiles at identical visual weight and left
 * the operator to work out which of them mattered. Everything here is
 * subordinated to a single decision, and anything that is not evidence for that
 * decision has moved behind the detail tabs.
 *
 * "Assessing" is a first-class state, not a loading spinner. The projection
 * needs about a minute of telemetry before it can measure a trend, and until
 * then the honest output is a dash — not a number, and not a recommendation to
 * continue that nothing has actually evaluated.
 */

const ACTION_LABEL: Record<MissionBlock["recommendation"], string> = {
  assessing: "Assessing",
  continue: "Continue mission",
  derate: "Reduce power",
  return_to_base: "Return to base",
  land_immediately: "Land immediately",
};

// Deliberately one word each. This line sits under a large action and is read
// at a glance; a sentence here competes with the action itself.
const ACTION_TONE: Record<MissionBlock["recommendation"], string> = {
  assessing: "idle",
  continue: "ok",
  derate: "caution",
  return_to_base: "caution",
  land_immediately: "critical",
};

function fmtDur(sec: number | null): string {
  if (sec === null) return "—";
  if (sec <= 0) return "0m";
  if (sec < 90) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function MissionStatus({ mission }: { mission: MissionBlock }) {
  const tone = ACTION_TONE[mission.recommendation];
  const { safeEnduranceSec: safe, missionRemainingSec: remaining, pSuccess } = mission;

  const pct = pSuccess === null ? null : Math.round(pSuccess * 100);
  const lo = mission.pSuccessLo === null ? null : Math.round(mission.pSuccessLo * 100);
  const hi = mission.pSuccessHi === null ? null : Math.round(mission.pSuccessHi * 100);

  // The endurance bar compares two durations that mean very different things:
  // how long the engine is good for, against how much sortie is left. Their
  // DIFFERENCE is the actual answer, so it gets the words. With no projection
  // yet there is no comparison to draw, so the bar is omitted entirely rather
  // than rendered empty and read as "zero endurance".
  const hasEndurance = safe !== null;
  const covers = hasEndurance && safe >= remaining;
  const fillPct = hasEndurance && remaining > 0 ? Math.min(100, (safe / remaining) * 100) : 0;
  const marginSec = hasEndurance ? Math.abs(safe - remaining) : null;

  return (
    <section className={`mission tone-${tone}`}>
      <div className="mission-top">
        <div className="mission-action">
          <div className="action-label">{ACTION_LABEL[mission.recommendation]}</div>
          {mission.derateTo !== null && <div className="action-sub">hold {mission.derateTo}% power</div>}
        </div>
        <div className="mission-p">
          <div className="p-value">{pct === null ? "—" : `${pct}%`}</div>
          <div className="p-caption">
            mission success
            {lo !== null && hi !== null && hi > lo && (
              <span className="p-band">
                {lo}–{hi}%
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="mission-reason">{mission.reason}</p>

      {hasEndurance && (
        <div className="endurance">
          <div className="endurance-bar">
            <div className={`endurance-fill ${covers ? "covers" : "short"}`} style={{ width: `${fillPct}%` }} />
          </div>
          <div className="endurance-legend">
            <span>
              <strong>{fmtDur(safe)}</strong> safe endurance
            </span>
            <span className={covers ? "spare" : "short"}>
              {covers ? `${fmtDur(marginSec)} spare` : `${fmtDur(marginSec)} short`}
            </span>
            <span>
              <strong>{fmtDur(remaining)}</strong> of sortie left
            </span>
          </div>
        </div>
      )}

      {/* Confidence is stated rather than folded silently into the number —
          a 60% assessment the model is unsure of is a different situation from
          a 60% it is certain of, and only one of them justifies acting. */}
      <div className="mission-meta">
        <span className={`conf conf-${mission.confidence}`}>{mission.confidence} confidence</span>
        <span className="basis">{mission.basis.replace(/_/g, " ")}</span>
      </div>
    </section>
  );
}
