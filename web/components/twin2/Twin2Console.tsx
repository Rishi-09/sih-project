"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EngineDetail, Fleet, FleetEngine, MissionAdvice, Reflection, SortieDetail, twin2, TWIN2_BASE,
  VERDICT_LABEL, Verdict, pct,
} from "@/lib/twin2";
import { DeficitBar, LineChart, ReliabilityPlot, SERIES } from "./Charts";

type View = "fleet" | "engine" | "sortie" | "mission" | "reflection";

const VIEWS: { id: View; label: string; models: string }[] = [
  { id: "fleet", label: "Fleet", models: "M2 · M5 · M8" },
  { id: "engine", label: "Engine", models: "M2 · M4 · M6 · M7" },
  { id: "sortie", label: "Sortie", models: "M1 · M2 · M6 · S2" },
  { id: "mission", label: "Mission planner", models: "M8 · R1–R3" },
  { id: "reflection", label: "Self-reflection", models: "S1 · S3" },
];

const CH_LABEL: Record<string, string> = {
  rpm: "RPM", map_kpa: "MAP (kPa)", fuel_flow_lph: "Fuel flow (L/h)", egt_1: "EGT 1 (°C)", egt_2: "EGT 2 (°C)",
  egt_3: "EGT 3 (°C)", egt_4: "EGT 4 (°C)", coolant_temp_c: "Coolant (°C)", oil_temp_c: "Oil temp (°C)",
  oil_press_bar: "Oil press (bar)", vib_rms_g: "Vibration (g)",
};

function VerdictPill({ v }: { v: Verdict }) {
  const cls = v === "go" ? "ok" : v === "conditional_go" ? "caution" : v === "no_go" ? "critical" : "muted";
  const icon = v === "go" ? "●" : v === "conditional_go" ? "▲" : v === "no_go" ? "■" : "○";
  return <span className={`t2-pill ${cls}`}><span aria-hidden>{icon}</span>{VERDICT_LABEL[v]}</span>;
}

function AttributionTag({ a }: { a: string }) {
  if (a === "none") return <span className="t2-tag muted">nominal</span>;
  if (a === "sensor") return <span className="t2-tag accent">sensor</span>;
  if (a === "engine") return <span className="t2-tag caution">engine</span>;
  return <span className="t2-tag caution">engine + sensor</span>;
}

function Md({ text }: { text: string }) {
  // Tiny renderer for the debrief: headings, bullets (2 levels), **bold**.
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
  return (
    <div className="t2-md">
      {text.split("\n").map((l, i) => {
        if (l.startsWith("# ")) return <h3 key={i}>{bold(l.slice(2))}</h3>;
        if (l.startsWith("## ")) return <h4 key={i}>{bold(l.slice(3))}</h4>;
        if (l.startsWith("  - ")) return <div key={i} className="li2">{bold(l.slice(4))}</div>;
        if (l.startsWith("- ")) return <div key={i} className="li">{bold(l.slice(2))}</div>;
        if (!l.trim()) return null;
        return <p key={i}>{bold(l)}</p>;
      })}
    </div>
  );
}

// ── Fleet ──────────────────────────────────────────────────────────────────

function FleetView({ fleet, open }: { fleet: Fleet; open: (id: string) => void }) {
  const inService = fleet.engines.filter((e) => e.in_service);
  const counts = { go: 0, conditional_go: 0, no_go: 0 } as Record<string, number>;
  inService.forEach((e) => (counts[e.verdict] = (counts[e.verdict] ?? 0) + 1));
  const sorted = [...fleet.engines].sort((a, b) =>
    Number(b.in_service) - Number(a.in_service) || b.deficit - a.deficit);
  return (
    <>
      <div className="t2-kpis">
        <div className="t2-kpi"><span>Engines in service</span><b>{inService.length}</b><em>of {fleet.engines.length}</em></div>
        <div className="t2-kpi"><span>Go</span><b className="ok">{counts.go}</b><em>for the reference mission</em></div>
        <div className="t2-kpi"><span>Conditional go</span><b className="caution">{counts.conditional_go}</b><em>options available</em></div>
        <div className="t2-kpi"><span>No-go</span><b className="critical">{counts.no_go}</b><em>swap or maintain</em></div>
        <div className="t2-kpi"><span>Failures observed</span><b>{fleet.engines.filter((e) => e.failed).length}</b><em>synthetic fleet history</em></div>
      </div>
      <p className="t2-sub">
        Reference mission: {fleet.mission.hours} h at {Math.round(fleet.mission.power * 100)}% loiter power,
        sea-level OAT {fleet.mission.oat_sl_c} °C, reliability budget P ≥ {fleet.mission.target}. Click an engine for its twin.
      </p>
      <div className="t2-table-wrap">
        <table className="t2-table">
          <thead>
            <tr>
              <th>Engine</th><th>Hours</th><th>Worst health factor (M2)</th><th className="num">Trend /100 h</th>
              <th>Thermal limit (M5)</th><th>Top cause (M6)</th><th className="num">P_complete (M8)</th><th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.engine_id} onClick={() => open(e.engine_id)} className="click">
                <td><b>{e.engine_id}</b>{e.scripted && <div className="t2-muted small">{e.scripted}</div>}</td>
                <td className="mono">{e.age_h.toFixed(0)}</td>
                <td className="nowrap">
                  <div className="t2-factor">
                    <DeficitBar value={e.deficit} />
                    <span className="mono">{fleet.labels[e.worst_factor] ?? e.worst_factor} · {pct(e.deficit, 0)}</span>
                  </div>
                </td>
                <td className="num mono">{e.deficit_trend_100h >= 0.01 ? `+${(100 * e.deficit_trend_100h).toFixed(0)}%` : "flat"}</td>
                <td className="mono small">
                  {e.hours_to_thermal_limit == null ? "—"
                    : e.hours_to_thermal_limit === 0 ? <span className="critical-text">now ({e.thermal_channel})</span>
                    : `${e.hours_to_thermal_limit.toFixed(0)} h (${e.thermal_channel})`}
                </td>
                <td className="small">{e.failed ? <span className="critical-text">Failed: {e.failure_kind.replaceAll("_", " ")}</span>
                  : e.top_cause ? e.top_cause.label : <span className="t2-muted">none</span>}</td>
                <td className="num mono">{e.p_complete == null ? "—" : e.p_complete.toFixed(3)}</td>
                <td><VerdictPill v={e.verdict} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Engine ─────────────────────────────────────────────────────────────────

function EngineView({ d, openSortie, showTruth }: { d: EngineDetail; openSortie: (n: number) => void; showTruth: boolean }) {
  const ages = d.sorties.map((s) => s.age_h);
  const e = d.engine;
  const flagged = d.sorties.filter((s) => s.sensor_faults.length || s.attribution !== "none");
  return (
    <>
      <div className="t2-kpis">
        <div className="t2-kpi"><span>Engine hours</span><b>{e.age_h.toFixed(0)}</b><em>{e.sorties} sorties · {e.serial}</em></div>
        <div className="t2-kpi"><span>Worst factor</span><b>{pct(e.deficit, 0)}</b><em>{d.labels[e.worst_factor]}</em></div>
        <div className="t2-kpi"><span>To failure threshold</span><b>{e.hours_to_failure_threshold == null ? "—" : `${e.hours_to_failure_threshold.toFixed(0)} h`}</b><em>{e.failure_factor ?? "no factor trending"}</em></div>
        <div className="t2-kpi"><span>Hot-day take-off limit</span><b>{e.hours_to_thermal_limit == null ? "—" : `${e.hours_to_thermal_limit.toFixed(0)} h`}</b><em>{e.thermal_channel ?? "no thermal limit in 1500 h"}</em></div>
        <div className="t2-kpi"><span>Status</span><b>{e.failed ? "Failed" : e.in_service ? "In service" : "Removed"}</b><em>{e.failure_kind || e.scripted || " "}</em></div>
      </div>

      <h3 className="t2-h">Health factors per sortie (M2), estimated from telemetry{showTruth ? " vs simulator ground truth" : ""}</h3>
      <p className="t2-sub">Each panel shows one physical property of this engine. The dashed red line is its failure threshold.
        The first {d.sorties.filter((s) => s.commissioning).length} sorties are L1 commissioning, when the per-engine baseline is learned.</p>
      <div className="t2-multiples">
        {d.health_factors.map((f, i) => (
          <LineChart key={f} x={ages} height={150} xLabel="engine hours"
            title={d.labels[f]} fmt={(v) => v.toFixed(2)}
            thresholds={[{ y: d.fail_thresholds[i], label: "failure" }]}
            series={[
              { id: "est", label: "twin estimate", color: SERIES[0], values: d.sorties.map((s) => s.theta[i]) },
              ...(showTruth ? [{ id: "true", label: "ground truth", color: "#75878f", dashed: true,
                values: d.truth.map((t) => t[`true_${f}`] as number) }] : []),
            ]} />
        ))}
      </div>

      <div className="t2-two">
        <div>
          <h3 className="t2-h">Cylinder EGT split (M4)</h3>
          <LineChart x={ages} height={210} xLabel="engine hours" fmt={(v) => `${v.toFixed(0)}°`} endLabels
            thresholds={[{ y: -25, label: "separation watch" }]}
            series={[0, 1, 2, 3].map((k) => ({ id: `c${k}`, label: `cyl ${k + 1}`, color: SERIES[k],
              values: d.sorties.map((s) => (s.commissioning ? null : s.cyl_dev[k])) }))} />
          <p className="t2-note">Each cylinder's EGT minus the mean of the other three, with build offsets removed. Distrusted sensors and L1 commissioning sorties are left out.</p>
        </div>
        <div>
          <h3 className="t2-h">Survival from now (M7)</h3>
          <LineChart x={d.survival.map((p) => p.h)} height={210} xLabel="further engine hours"
            fmt={(v) => v.toFixed(2)} yDomain={[0, 1]}
            series={[{ id: "s", label: "P(no failure)", color: SERIES[0], values: d.survival.map((p) => p.s) }]} />
          <p className="t2-note">Weibull proportional hazards at the current health deficit and trend, at 62% power. Censoring, late entry and time-varying covariates are handled in the fit.</p>
        </div>
      </div>

      <h3 className="t2-h">Sorties</h3>
      <div className="t2-table-wrap">
        <table className="t2-table">
          <thead><tr><th>#</th><th>Hours</th><th>M1 attribution</th><th>Sensor faults</th><th>Top cause (M6)</th><th>Worst factor</th>{showTruth && <th>Ground truth</th>}</tr></thead>
          <tbody>
            {[...d.sorties].reverse().map((s) => {
              const t = d.truth.find((r) => r.sortie === s.sortie);
              return (
                <tr key={s.sortie} className="click" onClick={() => openSortie(s.sortie)}>
                  <td className="mono">{s.sortie + 1}{s.commissioning && <span className="t2-muted small"> L1</span>}</td>
                  <td className="mono">{s.age_h.toFixed(0)}</td>
                  <td><AttributionTag a={s.attribution} /></td>
                  <td className="small">{s.sensor_faults.map((f) => `${f.channel} ${f.mode}`).join(", ") || "—"}</td>
                  <td className="small">{s.diagnosis.causes[0]?.label ?? "—"}</td>
                  <td className="small mono">{s.worst_factor} {pct(s.deficit, 0)}</td>
                  {showTruth && <td className="small t2-muted">{[t?.active_faults, t?.sf_channel && `${t.sf_channel} ${t.sf_mode}`,
                    t?.failed && `FAILED (${t.failure_kind})`].filter(Boolean).join(" · ") || "healthy"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {flagged.length === 0 && <p className="t2-note">No sortie on this engine raised a sensor or engine flag.</p>}
    </>
  );
}

// ── Sortie ─────────────────────────────────────────────────────────────────

function SortieView({ d, showTruth }: { d: SortieDetail; showTruth: boolean }) {
  const r = d.record;
  const firstFault = r.sensor_faults[0]?.channel;
  const [ch, setCh] = useState<string>(firstFault ?? "egt_3");
  useEffect(() => setCh(r.sensor_faults[0]?.channel ?? "egt_3"), [r]);
  const t = d.telemetry.t_s.map((v) => v / 60);
  const onset = r.sensor_faults.find((f) => f.channel === ch)?.onset_s;
  const hyps = Object.entries(r.hypotheses ?? {}).sort((a, b) => a[1] - b[1]);
  return (
    <>
      <div className="t2-row">
        {Object.keys(CH_LABEL).map((c) => (
          <button key={c} className={`t2-chip ${c === ch ? "on" : ""} ${r.sensor_faults.some((f) => f.channel === c) ? "flag" : ""}`}
            onClick={() => setCh(c)}>{CH_LABEL[c]}</button>
        ))}
      </div>
      <LineChart x={t} height={260} xLabel="minutes into sortie" fmt={(v) => v.toFixed(ch.includes("press") || ch.includes("vib") ? 2 : 0)}
        xFmt={(v) => v.toFixed(0)}
        bands={d.segments.map(([a, b]) => ({ x0: a / 60, x1: b / 60 }))}
        markers={onset != null ? [{ x: onset / 60, label: "M1: fault onset" }] : []}
        series={[
          { id: "meas", label: "measured", color: SERIES[0], values: d.telemetry[ch] },
          { id: "twin", label: "twin (virtual sensor)", color: "#a3b3bb", dashed: true, values: d.expected[ch] ?? [] },
        ]} />
      <p className="t2-note">The dashed trace is what this engine should read at this moment, given its fitted health factors
        and the other channels. Shaded bands are the steady holds that M2 fits on.</p>

      <div className="t2-two">
        <div className="t2-card">
          <h3 className="t2-h">Signal trust (M1)</h3>
          <div className="t2-row"><AttributionTag a={r.attribution} />{r.commissioning && <span className="t2-tag muted">L1 commissioning</span>}</div>
          {r.sensor_faults.length === 0 ? <p className="t2-sub">Every channel agrees with the physics twin.</p> :
            r.sensor_faults.map((f) => (
              <div key={f.channel} className="t2-fault">
                <b>{f.channel}: {f.mode}</b> <span className="mono">{pct(f.confidence, 0)}</span>
                <div className="t2-sub">{f.evidence}</div>
              </div>
            ))}
          {hyps.length > 1 && (
            <>
              <div className="t2-label">Competing explanations (penalized cost, lower wins)</div>
              <table className="t2-table compact">
                <tbody>{hyps.map(([k, v], i) => (
                  <tr key={k}><td>{k === "engine" ? "engine change, all sensors true" : `${k.split(":")[1]} sensor wrong`}</td>
                    <td className="num mono">{v.toFixed(0)}</td><td>{i === 0 ? "✓ chosen" : ""}</td></tr>))}</tbody>
              </table>
            </>
          )}
          {showTruth && (
            <p className="t2-note">Ground truth: {d.truth.sf_channel ? `${d.truth.sf_channel} ${d.truth.sf_mode} (${Number(d.truth.sf_magnitude).toFixed(2)})` : "no sensor fault"}
              {d.truth.active_faults ? ` · developing: ${d.truth.active_faults}` : ""}</p>
          )}
        </div>
        <div className="t2-card">
          <h3 className="t2-h">Diagnosis (M6)</h3>
          {r.diagnosis.causes.length === 0 ? <p className="t2-sub">No fault indicated ({pct(r.diagnosis.no_fault, 0)} no-fault weight).</p> :
            r.diagnosis.causes.map((c, i) => (
              <div key={c.id} className="t2-cause">
                <div className="t2-cause-head"><span className="mono">{i + 1}</span><b>{c.label}</b><span className="mono">{pct(c.score, 0)}</span></div>
                <div className="t2-check">First check: {c.check}</div>
                {c.evidence.map((e) => <div key={e} className="t2-sub small">· {e}</div>)}
              </div>
            ))}
        </div>
      </div>

      <div className="t2-card">
        <h3 className="t2-h">Auto-debrief (S2)</h3>
        <Md text={d.debrief_md} />
      </div>
    </>
  );
}

// ── Mission planner ───────────────────────────────────────────────────────

function MissionView({ fleet, initialEngine }: { fleet: Fleet; initialEngine: string }) {
  const [engine, setEngine] = useState(initialEngine);
  const [hours, setHours] = useState(20);
  const [power, setPower] = useState(62);
  const [target, setTarget] = useState(0.95);
  const [oat, setOat] = useState(30);
  const [res, setRes] = useState<MissionAdvice | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      twin2.mission({ engine_id: engine, hours, power: power / 100, target, oat_sl_c: oat })
        .then((r) => { setRes(r); setErr(null); }).catch((e) => setErr(String(e)));
    }, 150);
    return () => clearTimeout(id);
  }, [engine, hours, power, target, oat]);

  return (
    <>
      <div className="t2-form">
        <label>Engine
          <select value={engine} onChange={(e) => setEngine(e.target.value)}>
            {fleet.engines.map((e) => <option key={e.engine_id} value={e.engine_id}>{e.engine_id}{e.in_service ? "" : " (out of service)"}</option>)}
          </select>
        </label>
        <label>Sortie length <b>{hours} h</b><input type="range" min={2} max={30} value={hours} onChange={(e) => setHours(+e.target.value)} /></label>
        <label>Loiter power <b>{power}%</b><input type="range" min={40} max={80} value={power} onChange={(e) => setPower(+e.target.value)} /></label>
        <label>Sea-level OAT <b>{oat} °C</b><input type="range" min={-10} max={45} value={oat} onChange={(e) => setOat(+e.target.value)} /></label>
        <label>Reliability budget
          <select value={target} onChange={(e) => setTarget(+e.target.value)}>
            {[0.9, 0.95, 0.97, 0.99].map((t) => <option key={t} value={t}>P ≥ {t}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="critical-text">{err}</p>}
      {res && (
        <>
          <div className="t2-hero">
            <div>
              <div className="t2-label">P_complete for {res.engine_id}</div>
              <div className="t2-hero-num">{res.p_complete.toFixed(3)}</div>
              <div className="t2-sub mono">80% band {res.p_lo.toFixed(3)} – {res.p_hi.toFixed(3)}</div>
            </div>
            <div>
              <VerdictPill v={res.in_service ? res.verdict : "out_of_service"} />
              <div className="t2-sub">Budget P ≥ {res.target} (R1). {res.thermal_ok ? "Thermal margins OK." : "Thermal redline reachable: P halved."}</div>
              <div className="t2-sub small mono">{res.thermal_detail}</div>
            </div>
          </div>

          <div className="t2-two">
            <div className="t2-card">
              <h3 className="t2-h">Options (R3)</h3>
              <table className="t2-table compact">
                <thead><tr><th>Option</th><th className="num">P_complete</th><th>Verdict</th><th className="num">Time-on-station cost</th></tr></thead>
                <tbody>
                  <tr><td>As planned</td><td className="num mono">{res.p_complete.toFixed(3)}</td><td><VerdictPill v={res.verdict} /></td><td className="num mono">—</td></tr>
                  {res.options.map((o) => (
                    <tr key={o.id}><td>{o.label}</td><td className="num mono">{o.p_complete == null ? "—" : o.p_complete.toFixed(3)}</td>
                      <td><VerdictPill v={o.verdict} /></td><td className="num mono">{o.time_on_station_cost_h ? `${o.time_on_station_cost_h.toFixed(1)} h` : "none"}</td></tr>
                  ))}
                </tbody>
              </table>
              <h3 className="t2-h">What drives the risk</h3>
              {res.drivers.map((d) => (
                <div key={d.driver} className="t2-driver"><b>{d.driver}</b><span className="mono">{d.detail}</span></div>
              ))}
            </div>
            <div className="t2-card">
              <h3 className="t2-h">Fleet ranking for this mission (R2)</h3>
              <table className="t2-table compact">
                <thead><tr><th>#</th><th>Engine</th><th className="num">P_complete</th><th>Verdict</th><th className="num">Hours</th></tr></thead>
                <tbody>
                  {res.fleet_ranking.map((r, i) => (
                    <tr key={r.engine_id} className={r.engine_id === res.engine_id ? "sel" : ""}>
                      <td className="mono">{i + 1}</td><td><b>{r.engine_id}</b></td>
                      <td className="num mono">{r.p_complete.toFixed(4)}</td><td><VerdictPill v={r.verdict} /></td>
                      <td className="num mono">{r.age_h.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Reflection ─────────────────────────────────────────────────────────────

function ReflectionView({ r }: { r: Reflection }) {
  const v = r.validation;
  const rows: [string, string, string, boolean][] = [
    ["Sensor-vs-engine attribution (M1)", "≥ 85%", `${pct(v.attribution.accuracy)} of ${v.attribution.n_events} events`, v.attribution.accuracy >= 0.85],
    ["Slow faults seen as health drift before the limit (M2)", "≥ 4 of 5 kinds", `${v.slow_faults.kinds_detected_before_limit} of ${v.slow_faults.kinds_present}`, v.slow_faults.kinds_detected_before_limit >= 4],
    ["M6 top-3 contains the true cause", "≥ 80%", `${pct(v.diagnosis_top3.accuracy)} of ${v.diagnosis_top3.n}`, v.diagnosis_top3.accuracy >= 0.8],
    ["P_complete, verdict and options for any profile (M8)", "yes", "yes (see Mission planner)", true],
    ["Ledger reliability plot and per-sortie debrief (S1–S3)", "yes", `Brier ${r.calibration.brier.toFixed(4)} vs ${r.calibration.brier_climatology.toFixed(4)} climatology`, true],
  ];
  return (
    <>
      <h3 className="t2-h">Prototype success criteria (plan B5)</h3>
      <table className="t2-table">
        <thead><tr><th>Check</th><th>Target</th><th>Result</th><th>Status</th></tr></thead>
        <tbody>{rows.map(([a, b, c, ok]) => (
          <tr key={a}><td>{a}</td><td className="mono">{b}</td><td className="mono">{c}</td>
            <td>{ok ? <span className="t2-pill ok"><span aria-hidden>●</span>Pass</span> : <span className="t2-pill critical"><span aria-hidden>■</span>Fail</span>}</td></tr>))}</tbody>
      </table>
      {v.robustness && (
        <p className="t2-note">Physics-mismatch stress test (the twin's coefficients are wrong by ±{((v.robustness.coef_error ?? 0) * 100).toFixed(0)}%):
          attribution {pct(v.robustness.attribution)}, M6 top-3 {pct(v.robustness.diagnosis_top3)}, false sensor flags {pct(v.robustness.false_sensor_rate)}.</p>
      )}
      <p className="t2-note">Scored on synthetic data. The twin's physics has the same structure as the simulator, so these numbers show the architecture works.
        They are not a claim of accuracy on real engines; that comes from the 6-month plan's test-bed and replay validation.</p>

      <div className="t2-two">
        <div className="t2-card">
          <h3 className="t2-h">Reliability: predicted vs realized (S3)</h3>
          <ReliabilityPlot bins={r.calibration.bins} />
          <table className="t2-table compact">
            <thead><tr><th>Bin</th><th className="num">Sorties</th><th className="num">Predicted</th><th className="num">Realized</th><th className="num">Failures</th></tr></thead>
            <tbody>{r.calibration.bins.map((b) => (
              <tr key={b.bin}><td className="mono">{b.bin}</td><td className="num mono">{b.n}</td><td className="num mono">{b.predicted.toFixed(3)}</td>
                <td className="num mono">{b.realized.toFixed(3)}</td><td className="num mono">{b.failures}</td></tr>))}</tbody>
          </table>
        </div>
        <div className="t2-card">
          <h3 className="t2-h">Prediction ledger (S1)</h3>
          <table className="t2-table compact">
            <thead><tr><th>Model</th><th>Prediction</th><th className="num">Logged</th><th className="num">Resolved</th><th className="num">Correct</th></tr></thead>
            <tbody>{r.ledger.map((l) => (
              <tr key={l.model + l.kind}><td className="mono">{l.model}</td><td>{l.kind}</td><td className="num mono">{l.n}</td>
                <td className="num mono">{l.resolved}</td><td className="num mono">{l.resolved === 0 ? "open" : l.accuracy == null ? "see calibration" : pct(l.accuracy)}</td></tr>))}</tbody>
          </table>
          <h3 className="t2-h">Slow-fault detection lead time</h3>
          <table className="t2-table compact">
            <thead><tr><th>Fault</th><th>Engine</th><th className="num">Detected at</th><th className="num">Limit at</th><th className="num">Lead</th></tr></thead>
            <tbody>{Object.entries(v.slow_faults.per_kind).flatMap(([k, arr]) => arr.map((x, j) => (
              <tr key={`${k}-${x.engine_id}-${x.factor}-${j}`}><td>{k.replaceAll("_", " ")}</td><td className="mono">{x.engine_id}</td>
                <td className="num mono">{x.detected_at_h?.toFixed(0) ?? "—"} h</td>
                <td className="num mono">{x.limit_at_h == null ? "not reached" : `${x.limit_at_h.toFixed(0)} h`}</td>
                <td className="num mono">{x.lead_h == null ? "—" : `${x.lead_h.toFixed(0)} h`}</td></tr>)))}</tbody>
          </table>
          <p className="t2-note">M7: Weibull k = {r.model.k.toFixed(2)}, fitted on {r.model.n_events} failures across {r.model.n_intervals} sortie intervals.
            Survival bands are wide, as the plan expects with so few failures.</p>
        </div>
      </div>
    </>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

export function Twin2Console() {
  const [view, setView] = useState<View>("fleet");
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [engineId, setEngineId] = useState("UAV-03");
  const [engine, setEngine] = useState<EngineDetail | null>(null);
  const [sortieN, setSortieN] = useState<number | null>(null);
  const [sortie, setSortie] = useState<SortieDetail | null>(null);
  const [refl, setRefl] = useState<Reflection | null>(null);
  const [showTruth, setShowTruth] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // deep links: /twin2?view=sortie&engine=UAV-11&sortie=19
    const q = new URLSearchParams(window.location.search);
    const v = q.get("view") as View | null;
    if (v && VIEWS.some((x) => x.id === v)) setView(v);
    if (q.get("engine")) setEngineId(q.get("engine") as string);
    if (q.get("sortie")) setSortieN(Number(q.get("sortie")));
    twin2.fleet().then(setFleet).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => { setEngine(null); twin2.engine(engineId).then(setEngine).catch((e) => setErr(String(e))); }, [engineId]);
  useEffect(() => {
    if (sortieN == null) return;
    setSortie(null);
    twin2.sortie(engineId, sortieN).then(setSortie).catch((e) => setErr(String(e)));
  }, [engineId, sortieN]);
  useEffect(() => { if (view === "reflection" && !refl) twin2.reflection().then(setRefl).catch((e) => setErr(String(e))); }, [view, refl]);

  const openEngine = useCallback((id: string) => { setEngineId(id); setSortieN(null); setView("engine"); }, []);
  const openSortie = useCallback((n: number) => { setSortieN(n); setView("sortie"); }, []);
  useEffect(() => {
    if (view === "sortie" && sortieN == null && engine) setSortieN(engine.sorties[engine.sorties.length - 1].sortie);
  }, [view, sortieN, engine]);

  const engineIds = useMemo(() => fleet?.engines.map((e) => e.engine_id) ?? [], [fleet]);

  return (
    <main className="t2">
      <header className="t2-header">
        <div>
          <div className="t2-crumbs"><Link href="/">Live console</Link> / Fleet twin</div>
          <h1>Engine digital twin: fleet health and mission advisory</h1>
          <p className="t2-sub">Rotax 915 iS · physics-hybrid twin M1–M8 with a self-reflection loop · synthetic 20-engine fleet (3-day prototype)</p>
        </div>
        <label className="t2-toggle"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> Show simulator ground truth</label>
      </header>

      <nav className="t2-tabs">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>
            {v.label}<span>{v.models}</span>
          </button>
        ))}
        {(view === "engine" || view === "sortie") && (
          <div className="t2-pickers">
            <select value={engineId} onChange={(e) => { setEngineId(e.target.value); setSortieN(null); }}>
              {engineIds.map((id) => <option key={id}>{id}</option>)}
            </select>
            {view === "sortie" && engine && (
              <select value={sortieN ?? ""} onChange={(e) => setSortieN(+e.target.value)}>
                {engine.sorties.map((s) => (
                  <option key={s.sortie} value={s.sortie}>sortie {s.sortie + 1}{s.sensor_faults.length ? " · sensor flag" : ""}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </nav>

      {err && (
        <div className="t2-error">
          Could not reach the twin2 API at {TWIN2_BASE}. Start it with <code>python -m twin2.api</code> from the repo root.
          <div className="small mono">{err}</div>
        </div>
      )}

      {view === "fleet" && (fleet ? <FleetView fleet={fleet} open={openEngine} /> : !err && <p className="t2-sub">Loading fleet…</p>)}
      {view === "engine" && (engine ? <EngineView d={engine} openSortie={openSortie} showTruth={showTruth} /> : <p className="t2-sub">Loading {engineId}…</p>)}
      {view === "sortie" && (sortie ? <SortieView d={sortie} showTruth={showTruth} /> : <p className="t2-sub">Loading sortie…</p>)}
      {view === "mission" && fleet && <MissionView fleet={fleet} initialEngine={engineId} />}
      {view === "reflection" && (refl ? <ReflectionView r={refl} /> : <p className="t2-sub">Loading ledger…</p>)}
    </main>
  );
}
