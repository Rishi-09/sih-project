"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EngineSummary, ReliabilityLimiter, TickFrame } from "@/lib/types";
import { api } from "@/lib/api";
import { useTwinSocket } from "@/lib/socket";

interface Props {
  initialEngines: EngineSummary[];
}

/* -------------------------------------------------------------------------
   Formatting helpers
   ---------------------------------------------------------------------- */

const SUBSYSTEMS: Array<{ key: keyof TickFrame["health"]["subsystems"]; short: string; label: string }> = [
  { key: "lubrication", short: "LUB", label: "Lubrication" },
  { key: "cooling", short: "COOL", label: "Cooling" },
  { key: "combustion", short: "COMB", label: "Combustion" },
  { key: "induction", short: "IND", label: "Induction" },
  { key: "fuel", short: "FUEL", label: "Fuel" },
  { key: "injection", short: "INJ", label: "Injection" },
  { key: "mechanical", short: "MECH", label: "Mechanical" },
  { key: "electrical", short: "ELEC", label: "Electrical" },
];

const RECOMMENDATION_COPY: Record<string, { title: string; tone: "ok" | "caution" | "critical" | "idle" }> = {
  assessing: { title: "Assessing — not enough telemetry yet", tone: "idle" },
  continue: { title: "Continue as briefed", tone: "ok" },
  derate: { title: "Derate power", tone: "caution" },
  return_to_base: { title: "Return to base", tone: "critical" },
  land_immediately: { title: "Land immediately", tone: "critical" },
};

/** Health tone. Thresholds mirror the caution/critical bands used on the console. */
function tone(v: number | null | undefined): "ok" | "caution" | "critical" | "unknown" {
  if (v === null || v === undefined || Number.isNaN(v)) return "unknown";
  if (v < 50) return "critical";
  if (v < 70) return "caution";
  return "ok";
}

function cellStyle(v: number | null): React.CSSProperties {
  if (v === null) return { background: "var(--surface)", color: "var(--ink-4)" };
  if (v < 50) return { background: "rgba(240,90,110,0.45)", color: "#FFE2E6" };
  if (v < 70) return { background: "rgba(224,168,46,0.40)", color: "#FFF3D6" };
  if (v < 80) return { background: "rgba(46,154,208,0.20)", color: "#BFD8E6" };
  if (v < 90) return { background: "rgba(46,154,208,0.45)", color: "#DCEDF7" };
  return { background: "rgba(46,154,208,0.85)", color: "#04161E" };
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  if (sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} m`;
  return `${m} m ${String(s).padStart(2, "0")} s`;
}

function channelLabel(channel: string): string {
  const trimmed = channel.replace(/_(c|bar|kpa|lph|pct|rpm)$/i, "").replace(/_/g, " ");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/* -------------------------------------------------------------------------
   Residual chart — measured against the nominal twin, from the socket history
   ---------------------------------------------------------------------- */

function ResidualChart({ history, channel }: { history: TickFrame[]; channel: string }) {
  const series = useMemo(() => {
    const pts = history
      .map((f) => ({ actual: f.sensors?.[channel], expected: f.nominal?.[channel] }))
      .filter((p) => Number.isFinite(p.actual) && Number.isFinite(p.expected)) as Array<{ actual: number; expected: number }>;
    return pts.slice(-120);
  }, [history, channel]);

  if (series.length < 2) {
    return <div className="empty-note">Waiting for the twin to publish enough frames to draw a trend.</div>;
  }

  const all = series.flatMap((p) => [p.actual, p.expected]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.18 || 1;
  const min = lo - pad;
  const max = hi + pad;

  const W = 1000;
  const H = 300;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;

  const actualPts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.actual).toFixed(1)}`).join(" ");
  const expectedPts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.expected).toFixed(1)}`).join(" ");
  const band =
    `M${series.map((p, i) => `${x(i).toFixed(1)},${y(p.actual).toFixed(1)}`).join(" L")} ` +
    `L${series
      .map((p, i) => `${x(series.length - 1 - i).toFixed(1)},${y(series[series.length - 1 - i].expected).toFixed(1)}`)
      .join(" L")} Z`;

  const last = series[series.length - 1];
  const residual = last.actual - last.expected;

  return (
    <>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-line" style={{ background: "var(--series-1)" }} /> Measured
        </span>
        <span className="legend-item">
          <span className="legend-line" style={{ background: "var(--series-2)" }} /> Twin expected
        </span>
        <span
          className="card-meta"
          style={{ color: Math.abs(residual) > 1 ? "var(--critical)" : "var(--ink-2)", letterSpacing: 0 }}
        >
          residual {residual >= 0 ? "+" : ""}
          {fmt(residual)}
        </span>
      </div>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${channelLabel(channel)} measured against the twin-expected value, residual ${fmt(residual)}.`}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="var(--grid-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={band} fill="rgba(240,90,110,0.10)" />
          <polyline
            points={expectedPts}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth="2"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={actualPts}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="chart-axis">
        <span>−{series.length}s</span>
        <span>now</span>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------
   Dashboard
   ---------------------------------------------------------------------- */

const SAMPLE_FLEET: EngineSummary[] = [
  { id: "uav-01", tail: "UAV-01", model: "Rotax 915 iS", ehi: 94, latestRunId: null, latestRunStatus: "idle" },
  { id: "uav-02", tail: "UAV-02", model: "Rotax 915 iS", ehi: 84, latestRunId: null, latestRunStatus: "idle" },
  { id: "uav-03", tail: "UAV-03", model: "Rotax 915 iS", ehi: 94, latestRunId: null, latestRunStatus: "idle" },
];

export function DashboardOverview({ initialEngines }: Props) {
  const [engines, setEngines] = useState<EngineSummary[]>(initialEngines);
  const offline = engines.length === 0;
  const fleet = offline ? SAMPLE_FLEET : engines;

  // Keep the register fresh without a page reload.
  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      api
        .engines()
        .then((next) => !cancelled && setEngines(next))
        .catch(() => {
          /* backend asleep — keep the last good list */
        });
    const id = setInterval(pull, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The dashboard follows the airframe that most needs attention: the active
  // sortie with the lowest health, falling back to the lowest-health engine.
  const focus = useMemo(() => {
    const active = fleet.filter((e) => e.latestRunStatus === "live" || e.latestRunStatus === "degraded");
    const pool = active.length > 0 ? active : fleet;
    return [...pool].sort((a, b) => (a.ehi ?? 101) - (b.ehi ?? 101))[0] ?? null;
  }, [fleet]);

  const focusRunId =
    focus && (focus.latestRunStatus === "live" || focus.latestRunStatus === "degraded") ? focus.latestRunId : null;

  const twin = useTwinSocket(focusRunId);
  const frame = twin.latest;

  /* ---- KPIs ---- */
  const ready = fleet.filter((e) => (e.ehi ?? 0) >= 70).length;
  const degraded = fleet.filter((e) => e.ehi !== null && e.ehi >= 50 && e.ehi < 70).length;
  const grounded = fleet.filter((e) => e.ehi !== null && e.ehi < 50).length;
  const airborne = fleet.filter((e) => e.latestRunStatus === "live" || e.latestRunStatus === "degraded").length;
  const lowest = [...fleet].sort((a, b) => (a.ehi ?? 101) - (b.ehi ?? 101))[0] ?? null;

  const alerts = frame?.alerts ?? [];
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const cautionCount = alerts.filter((a) => a.severity === "caution").length;

  /* ---- Mission reliability ---- */
  const mission = frame?.mission ?? null;
  const rec = RECOMMENDATION_COPY[mission?.recommendation ?? "assessing"] ?? RECOMMENDATION_COPY.assessing;
  const limiters: ReliabilityLimiter[] = mission?.limiters ?? [];
  const bindingChannel = limiters[0]?.channel ?? "oil_temp_c";

  /* ---- Diagnosis ---- */
  const diagnosis = frame?.diagnosis ?? null;
  const topClasses = useMemo(() => {
    if (!diagnosis?.probs) return [];
    return Object.entries(diagnosis.probs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [diagnosis]);

  const subsystems = frame?.health?.subsystems ?? null;

  return (
    <div className="dash">
      {/* ---------- ROW 1 — KPIs ---------- */}
      <div className="dash-kpis">
        <div className="kpi">
          <span className="eyebrow">MISSION READY</span>
          <div className="kpi-row">
            <span className="kpi-value">{ready}</span>
            <span className="kpi-unit">/ {fleet.length}</span>
            <span className="kpi-spacer" />
            <span className="kpi-stack" aria-hidden="true">
              {fleet.slice(0, 8).map((e) => {
                const t = tone(e.ehi);
                return (
                  <i
                    key={e.id}
                    style={{
                      height: t === "ok" ? "100%" : t === "caution" ? "62%" : t === "critical" ? "34%" : "20%",
                      background:
                        t === "ok"
                          ? "var(--ok)"
                          : t === "caution"
                            ? "var(--caution)"
                            : t === "critical"
                              ? "var(--critical)"
                              : "var(--ink-4)",
                    }}
                  />
                );
              })}
            </span>
          </div>
          <span className="kpi-foot">
            {degraded} degraded · {grounded} grounded
          </span>
        </div>

        <div className="kpi">
          <span className="eyebrow">LOWEST EHI</span>
          <div className="kpi-row">
            <span className={`kpi-value is-${tone(lowest?.ehi)}`}>
              {lowest?.ehi === null || lowest?.ehi === undefined ? "—" : Math.round(lowest.ehi)}
            </span>
            <span className="kpi-unit">{lowest?.tail ?? ""}</span>
          </div>
          <span className={`kpi-foot ${tone(lowest?.ehi) === "ok" ? "" : "is-caution"}`}>
            {lowest?.ehi === null || lowest?.ehi === undefined
              ? "No health evaluation yet"
              : `${SUBSYSTEMS.length} subsystems scored`}
          </span>
        </div>

        <div className="kpi">
          <span className="eyebrow">SORTIES AIRBORNE</span>
          <div className="kpi-row">
            <span className="kpi-value">{airborne}</span>
            <span className="kpi-spacer" />
            {mission?.missionRemainingSec ? (
              <span className="kpi-unit" style={{ fontSize: 11 }}>
                {fmtDuration(mission.missionRemainingSec)} rem
              </span>
            ) : null}
          </div>
          <span className="kpi-foot">
            {focusRunId ? `Following ${focus?.tail}` : "No active run — start one from a console"}
          </span>
        </div>

        <div className={`kpi ${criticalCount > 0 ? "is-alert" : ""}`}>
          <span className="eyebrow">OPEN ALERTS</span>
          <div className="kpi-row">
            <span className={`kpi-value ${criticalCount > 0 ? "is-critical" : cautionCount > 0 ? "is-caution" : ""}`}>
              {alerts.length}
            </span>
            <span className="kpi-spacer" />
            <span style={{ display: "flex", gap: 5 }}>
              {criticalCount > 0 && <span className="chip is-critical">{criticalCount} CRIT</span>}
              {cautionCount > 0 && <span className="chip is-caution">{cautionCount} CAUT</span>}
            </span>
          </div>
          <span className="kpi-foot">{alerts.length === 0 ? "No unacknowledged alerts" : alerts[0].message}</span>
        </div>
      </div>

      {/* ---------- ROW 2 — reliability + subsystem health ---------- */}
      <div className="dash-row">
        <section className="card dash-col-wide">
          <div className="card-head">
            <h2 className="card-title">Mission Reliability</h2>
            {focus && <span className="card-chip">{focus.tail}</span>}
            <span className="card-meta">{mission?.basis ? mission.basis.toUpperCase() : "AWAITING PROJECTION"}</span>
          </div>

          <div className="mr-body">
            <div className="mr-hero">
              <span className="eyebrow">P(COMPLETE SORTIE)</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span className={`mr-p is-${rec.tone}`} style={{ color: `var(--${rec.tone === "idle" ? "ink-3" : rec.tone})` }}>
                  {mission?.pSuccess !== null && mission?.pSuccess !== undefined ? mission.pSuccess.toFixed(2) : "—"}
                </span>
                {mission?.pSuccessLo !== null && mission?.pSuccessHi !== null && mission?.pSuccessLo !== undefined && (
                  <span className="mr-ci">
                    {mission.pSuccessLo.toFixed(2)}–{mission.pSuccessHi?.toFixed(2)}
                  </span>
                )}
              </div>

              <div className="mr-band">
                {mission?.pSuccessLo !== null && mission?.pSuccessLo !== undefined && mission?.pSuccessHi && (
                  <span
                    className="mr-band-ci"
                    style={{
                      left: `${mission.pSuccessLo * 100}%`,
                      width: `${Math.max(0, (mission.pSuccessHi - mission.pSuccessLo) * 100)}%`,
                    }}
                  />
                )}
                <span
                  className="mr-band-fill"
                  style={{
                    width: `${(mission?.pSuccess ?? 0) * 100}%`,
                    background: `var(--${rec.tone === "idle" ? "ink-4" : rec.tone})`,
                  }}
                />
              </div>

              <div className="mr-scale">
                <span>0.0</span>
                <span>confidence: {mission?.confidence ?? "—"}</span>
                <span>1.0</span>
              </div>
            </div>

            <span className="vrule" />

            <div className="mr-right">
              <span className="eyebrow">RECOMMENDATION</span>
              <div className={`mr-rec is-${rec.tone}`}>
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={`var(--${rec.tone === "idle" ? "ink-3" : rec.tone})`}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" />
                  <path d="M12 9.5v4M12 17h.01" />
                </svg>
                <span className="mr-rec-text">
                  <span className="mr-rec-title" style={{ color: `var(--${rec.tone === "idle" ? "ink-2" : rec.tone})` }}>
                    {rec.title}
                    {mission?.derateTo ? ` to ${Math.round(mission.derateTo)} %` : ""}
                  </span>
                  <span className="mr-rec-why">
                    {mission?.reason ?? "The projection needs about a minute of telemetry before it can measure a trend."}
                  </span>
                </span>
              </div>

              <div className="mr-actions">
                {focus && (
                  <Link href={`/uav/${focus.id}`} className="btn-primary">
                    Open console
                  </Link>
                )}
                <Link href="/fleet" className="btn-secondary">
                  Fleet register
                </Link>
                {focus && (
                  <Link href={`/uav/${focus.id}/twin3d`} className="btn-secondary">
                    3D twin
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="card-head" style={{ gap: 8 }}>
            <span className="eyebrow">LIMITERS · BINDING FIRST</span>
            <span className="hrule" />
          </div>

          <div className="limiters">
            {limiters.length === 0 && (
              <div className="empty-note">
                No reliability projection yet. Start a sortie from an engine console and the binding limiter appears here.
              </div>
            )}
            {limiters.slice(0, 3).map((l, i) => {
              const state = i === 0 && l.beyondCaution ? "binding" : l.beyondCaution ? "caution" : "ok";
              const colour = state === "binding" ? "var(--critical)" : state === "caution" ? "var(--caution)" : "var(--ok)";
              return (
                <div key={l.channel} className={`limiter-row ${state === "binding" ? "is-binding" : ""}`}>
                  <span className={`lim-chip is-${state}`}>
                    {state === "binding" ? "BINDING" : state === "caution" ? "CAUTION" : "NOMINAL"}
                  </span>
                  <span className="lim-name">{channelLabel(l.channel)}</span>
                  <span className="lim-val">
                    {fmt(l.value)} / {fmt(l.limit, 0)} {l.unit}
                  </span>
                  <span className="lim-track">
                    <span
                      className="lim-fill"
                      style={{ width: `${Math.max(2, Math.min(100, l.headroomPct))}%`, background: colour }}
                    />
                  </span>
                  <span className="lim-rate">
                    {l.ratePerMin >= 0 ? "+" : ""}
                    {fmt(l.ratePerMin, 2)}/min
                  </span>
                  <span className="lim-t2l">{fmtDuration(l.secondsToLimit)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card dash-col-rest">
          <div className="card-head">
            <h2 className="card-title">Subsystem health</h2>
            <span className="card-meta">EHI 0–100</span>
          </div>

          {subsystems ? (
            <>
              <div className="matrix-head">
                {SUBSYSTEMS.map((s) => (
                  <span key={s.key}>{s.short}</span>
                ))}
              </div>
              <div className="matrix-body" style={{ minHeight: 44 }}>
                <div className="matrix-row">
                  <span className="matrix-tail">{focus?.tail}</span>
                  {SUBSYSTEMS.map((s) => {
                    const v = subsystems[s.key];
                    return (
                      <span key={s.key} className="matrix-cell" style={cellStyle(v)} title={s.label}>
                        {v === null ? "—" : Math.round(v)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-note">
              Per-subsystem scores arrive once a sortie is live. Fleet health index is shown below.
            </div>
          )}

          <div className="card-head" style={{ gap: 8 }}>
            <span className="eyebrow">FLEET ENGINE HEALTH INDEX</span>
            <span className="hrule" />
          </div>

          <div className="matrix-body is-list">
            {fleet.map((e) => {
              const t = tone(e.ehi);
              return (
                <Link key={e.id} href={`/uav/${e.id}`} className="matrix-row" style={{ textDecoration: "none" }}>
                  <span className="matrix-tail">{e.tail}</span>
                  <span className="lim-track" style={{ height: 8, alignSelf: "center" }}>
                    <span
                      className="lim-fill"
                      style={{
                        width: `${e.ehi ?? 0}%`,
                        background: t === "unknown" ? "var(--ink-4)" : `var(--${t})`,
                      }}
                    />
                  </span>
                  <span
                    className="lim-t2l"
                    style={{ color: t === "unknown" ? "var(--ink-3)" : `var(--${t})`, fontWeight: 600 }}
                  >
                    {e.ehi === null ? "—" : Math.round(e.ehi)}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="legend">
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "rgba(46,154,208,0.85)" }} /> 90+
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "rgba(46,154,208,0.45)" }} /> 80–89
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "rgba(224,168,46,0.40)" }} /> caution
            </span>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: "rgba(240,90,110,0.45)" }} /> critical
            </span>
          </div>
        </section>
      </div>

      {/* ---------- ROW 3 — residual, diagnosis, alerts ---------- */}
      <div className="dash-row dash-row-3">
        <section className="card">
          <div className="card-head">
            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
              <h2 className="card-title">Residual — {channelLabel(bindingChannel).toLowerCase()}</h2>
              <span className="card-sub">Measured against the nominal twin{focus ? `, ${focus.tail}` : ""}</span>
            </div>
          </div>
          <ResidualChart history={twin.history} channel={bindingChannel} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Diagnosis</h2>
            <span className="card-meta">91-STATE CLASSIFIER</span>
          </div>

          <div className={`diag-top ${!diagnosis ? "is-idle" : diagnosis.label === "healthy" ? "is-ok" : ""}`}>
            <span className="diag-top-label">TOP CLASS</span>
            <span className="diag-top-class">
              {diagnosis ? channelLabel(diagnosis.label) : "Not yet classified"}
            </span>
            <span className="diag-top-why">
              {diagnosis
                ? `Confidence ${diagnosis.confidence.toFixed(2)}${
                    diagnosis.cylinder ? ` · cylinder ${diagnosis.cylinder}` : ""
                  }${diagnosis.sensorFault?.channel ? ` · sensor ${diagnosis.sensorFault.mode} on ${diagnosis.sensorFault.channel}` : ""}`
                : "The classifier needs residuals from a live run before it can name a state."}
            </span>
          </div>

          <div className="diag-bars">
            {topClasses.length === 0 && <div className="empty-note">No class probabilities yet.</div>}
            {topClasses.map(([label, p], i) => (
              <div key={label} className="diag-bar">
                <div className="diag-bar-head">
                  <span className="diag-bar-name">{channelLabel(label)}</span>
                  <span className="diag-bar-p">{p.toFixed(2)}</span>
                </div>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.max(1, p * 100)}%`,
                      background: i === 0 ? "var(--series-1)" : i === 1 ? "var(--series-2)" : "var(--series-3)",
                    }}
                  />
                </span>
              </div>
            ))}
          </div>

          <div className="diag-stats">
            <div className="stat-mini">
              <span className="stat-mini-label">ANOMALY</span>
              <span
                className={`stat-mini-value ${
                  diagnosis && diagnosis.anomalyScore > 0.3 ? "is-caution" : diagnosis ? "is-ok" : ""
                }`}
              >
                {diagnosis ? diagnosis.anomalyScore.toFixed(2) : "—"}
              </span>
              <span className="stat-mini-foot">Isolation Forest</span>
            </div>
            <div className="stat-mini">
              <span className="stat-mini-label">RUL</span>
              <span className="stat-mini-value">{fmtDuration(frame?.prognosis?.rulSec)}</span>
              <span className="stat-mini-foot">
                {frame?.prognosis?.rulLoSec != null
                  ? `${fmtDuration(frame.prognosis.rulLoSec)}–${fmtDuration(frame.prognosis.rulHiSec)}`
                  : "band pending"}
              </span>
            </div>
            <div className="stat-mini">
              <span className="stat-mini-label">SENSOR</span>
              <span className={`stat-mini-value ${diagnosis?.sensorFault?.channel ? "is-caution" : "is-ok"}`}>
                {diagnosis?.sensorFault?.channel ? "FAULT" : "OK"}
              </span>
              <span className="stat-mini-foot">
                {diagnosis?.sensorFault?.channel ? diagnosis.sensorFault.channel : "No drift or bias"}
              </span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Alert queue</h2>
            <Link href="/fleet" className="card-meta" style={{ color: "var(--accent)" }}>
              All
            </Link>
          </div>

          <div className="alert-list">
            {alerts.length === 0 && (
              <div className="empty-note">
                {focusRunId ? "All channels inside their bands." : "No live sortie — nothing to report."}
              </div>
            )}
            {alerts.slice(0, 5).map((a) => (
              <div key={a.code + a.channel} className={`alert-item ${a.severity === "critical" ? "is-critical" : ""}`}>
                <div className="alert-head">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={a.severity === "critical" ? "var(--critical)" : "var(--caution)"}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" />
                    <path d="M12 9.5v4M12 17h.01" />
                  </svg>
                  <span
                    className="alert-code"
                    style={{ color: a.severity === "critical" ? "var(--critical)" : "var(--caution)" }}
                  >
                    {a.severity.toUpperCase()} · {a.code}
                  </span>
                </div>
                <span className="alert-msg">{a.message}</span>
              </div>
            ))}
          </div>

          {offline && (
            <div className="empty-note" style={{ marginTop: "auto" }}>
              Backend unreachable — showing a sample fleet so the layout stays readable.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
