"use client";

import { TickFrame, TwinBlock } from "@/lib/types";

/**
 * The live physics twin's evidence (twin2/live.py), in the order an engineer
 * checks it: is it the engine or a sensor, which physical property moved, what
 * to check first, and how long until a limit.
 */

const CH: Record<string, string> = {
  egt_1: "EGT 1", egt_2: "EGT 2", egt_3: "EGT 3", egt_4: "EGT 4", cht_1: "CHT 1", cht_2: "CHT 2",
  cht_3: "CHT 3", cht_4: "CHT 4", coolant_temp_c: "Coolant", oil_temp_c: "Oil temp",
  oil_press_bar: "Oil pressure", map_kpa: "MAP", fuel_flow_lph: "Fuel flow", rpm: "RPM", vib_rms_g: "Vibration",
};
const ch = (c: string) => CH[c] ?? c.replace(/_/g, " ");

const ATTRIBUTION: Record<TwinBlock["attribution"], { text: string; cls: string }> = {
  none: { text: "Engine healthy, all sensors trusted", cls: "tw-ok" },
  engine: { text: "Engine change: several channels moved together, as the physics predicts", cls: "tw-warn" },
  sensor: { text: "Sensor fault: one reading disagrees with everything else. Engine judged healthy", cls: "tw-accent" },
  both: { text: "Engine change and a distrusted sensor", cls: "tw-warn" },
};

function fmtSec(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function PhysicsTwinPanel({ frame, compact = false }: { frame: TickFrame | null; compact?: boolean }) {
  const t = frame?.twin;
  if (!t) {
    const reason = !frame
      ? "No telemetry yet."
      : frame.diagnosis.label === "assessing"
        ? "Assessing: the twin needs about 75 s of airborne telemetry before its first estimate."
        : "No physics-twin output on this run. The server is using the stub backend because the live simulator (retribution/run_ws_only.py) was unreachable when the sortie started.";
    return <p className="tw-empty">{reason}</p>;
  }
  const attr = ATTRIBUTION[t.attribution];
  const factors = compact ? [...t.factors].sort((a, b) => b.deficit - a.deficit).slice(0, 4) : t.factors;
  const hyps = Object.entries(t.hypotheses).sort((a, b) => a[1] - b[1]);

  return (
    <div className={`tw ${compact ? "tw-compact" : ""}`}>
      <div className={`tw-attr ${attr.cls}`}>{attr.text}</div>

      {t.sensorFaults.length > 0 && (
        <div className="tw-block">
          <div className="tw-h">Distrusted sensors (M1)</div>
          {t.sensorFaults.map((f) => (
            <div key={f.channel} className="tw-sensor">
              <b>{ch(f.channel)}</b> <span className="tw-mode">{f.mode}</span>{" "}
              <span className="tw-muted">
                {Math.round(f.confidence * 100)}% · since t={f.onset_s ?? "?"} s
              </span>
              {!compact && <div className="tw-muted tw-small">{f.evidence}. Excluded from the health fit.</div>}
            </div>
          ))}
        </div>
      )}

      <div className="tw-block">
        <div className="tw-h">
          Health factors (M2) <span className="tw-muted">· bar = way to failure threshold</span>
        </div>
        {factors.map((f) => {
          const d = Math.max(0, Math.min(1, f.deficit));
          const cls = d >= 0.75 ? "crit" : d >= 0.4 ? "warn" : d >= 0.1 ? "watch" : "ok";
          return (
            <div key={f.name} className="tw-factor" title={`healthy ${f.healthy} · fails at ${f.fail} · ±${f.sd}`}>
              <span className="tw-fname">{f.label}</span>
              <span className="tw-track">
                <span className={`tw-fill ${cls}`} style={{ width: `${Math.max(1.5, d * 100)}%` }} />
              </span>
              <span className="tw-fval mono">
                {f.value.toFixed(3)} <span className="tw-muted">({Math.round(d * 100)}%)</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="tw-block">
        <div className="tw-h">Root cause (M6)</div>
        {t.causes.length === 0 ? (
          <div className="tw-muted">No fault indicated.</div>
        ) : (
          t.causes.map((c, i) => (
            <div key={c.id} className="tw-cause">
              <div className="tw-cause-head">
                <span className="tw-rank mono">{i + 1}</span>
                <b>{c.label}</b>
                <span className="mono tw-muted">{Math.round(c.score * 100)}%</span>
              </div>
              <div className="tw-check">First check: {c.check}</div>
              {!compact && c.evidence.map((e) => <div key={e} className="tw-muted tw-small tw-ev">· {e}</div>)}
            </div>
          ))
        )}
      </div>

      <div className={compact ? "tw-block" : "tw-row2"}>
        <div className="tw-block">
          <div className="tw-h">Thermal limits (M5)</div>
          {t.limitingChannel ? (
            <div className="tw-crit-text">
              {ch(t.limitingChannel)} reaches its redline in <b>{fmtSec(t.timeToLimit[t.limitingChannel])}</b> if
              this power is held.
            </div>
          ) : (
            <div>No thermal redline is reachable at the current power.</div>
          )}
          <div className="tw-muted tw-small">
            Hot-day take-off (100%, sea level, 40 °C): {ch(t.hotTakeoff.channel)}{" "}
            {t.hotTakeoff.margin < 0
              ? `${Math.abs(t.hotTakeoff.margin).toFixed(1)} below redline`
              : `${t.hotTakeoff.margin.toFixed(1)} OVER redline`}
          </div>
        </div>
        {!compact && (
          <div className="tw-block">
            <div className="tw-h">Cylinder EGT split (M4)</div>
            <div className="tw-cyls">
              {t.cylDev.map((v, i) => (
                <div key={i} className={`tw-cyl ${v !== null && v < -25 ? "low" : ""}`}>
                  <span className="tw-muted">cyl {i + 1}</span>
                  <span className="mono">{v === null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(0)}°`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!compact && hyps.length > 1 && (
        <div className="tw-block">
          <div className="tw-h">
            Explanations weighed by M1 <span className="tw-muted">· penalized cost, lowest wins</span>
          </div>
          {hyps.map(([k, v], i) => {
            const sensorCh = k.startsWith("sensor:") ? k.slice("sensor:".length) : null;
            return (
              <div key={k} className="tw-hyp">
                <span>{sensorCh ? `${ch(sensorCh)} sensor is wrong` : "Engine changed, every sensor true"}</span>
                <span className="mono">{v.toFixed(0)}</span>
                <span className="tw-muted">{i === 0 ? "chosen" : ""}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="tw-foot tw-muted">
        {t.windowS} s window · fit residual {t.unexplained.toFixed(2)} (≈1 is sensor noise) · {t.computeMs} ms · t={t.t} s
      </div>
    </div>
  );
}
