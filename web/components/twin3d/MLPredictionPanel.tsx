"use client";

import { TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
}

function fmtSec(s: number | null): string {
  if (s === null) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function getEhiGrade(ehi: number | null) {
  // No evaluation yet is its own grade — not the top one.
  if (ehi === null) return "ehi-unknown";
  if (ehi >= 80) return "ehi-good";
  if (ehi >= 50) return "ehi-warn";
  return "ehi-crit";
}

export function MLPredictionPanel({ frame }: Props) {
  if (!frame) {
    return (
      <div className="panel-inner ml-panel-scroll">
        <div className="panel-header-badge">
          <span className="badge-title">AI / ML PREDICTIONS</span>
          <span className="badge-freq">AWAITING RUN</span>
        </div>
        <div className="empty-ml-state">Connect to active sortie to initialize AI inference pipeline.</div>
      </div>
    );
  }

  const { diagnosis, health, prognosis, mission } = frame;
  const sortedProbs = Object.entries(diagnosis.probs || {}).sort((a, b) => b[1] - a[1]);
  const isHealthy = diagnosis.label === "healthy";

  return (
    <div className="panel-inner ml-panel-scroll">
      <div className="panel-header-badge">
        <span className="badge-title">AI Diagnostics</span>
        <span className={`badge-status ${isHealthy ? "status-ok" : "status-fault"}`}>
          {isHealthy ? "Nominal" : "Fault Detected"}
        </span>
      </div>

      {/* Primary Diagnosis & Confidence */}
      <div className="section-block">
        <div className="section-title">Health State</div>
        <div className="diag-header-card">
          <div className="diag-main-title">
            {diagnosis.label.replace(/_/g, " ")}
            {diagnosis.cylinder ? ` (Cyl ${diagnosis.cylinder})` : ""}
          </div>
          <div className="diag-metrics-row">
            <span className="diag-conf-badge">
              Confidence: {Math.round(diagnosis.confidence * 100)}%
            </span>
            <span className="diag-anomaly-badge">
              Anomaly: {diagnosis.anomalyScore.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Probability Breakdown */}
        <div className="prob-bars-container">
          {sortedProbs.slice(0, 4).map(([name, p]) => (
            <div key={name} className="prob-mini-row">
              <span className="prob-label">{name.replace(/_/g, " ")}</span>
              <div className="prob-track">
                <div className="prob-fill" style={{ width: `${Math.min(100, p * 100)}%` }} />
              </div>
              <span className="prob-pct">{Math.round(p * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Subsystem Health Scores */}
      <div className="section-block">
        <div className="section-title">Subsystems</div>
        <div className="subsystems-grid">
          {Object.entries(health.subsystems).map(([name, val]) => {
            const score = typeof val === "number" ? val : null;
            const grade =
              score === null ? "sub-unknown" : score >= 80 ? "sub-good" : score >= 50 ? "sub-warn" : "sub-crit";
            return (
              <div key={name} className={`subsystem-card ${grade}`}>
                <span className="sub-name">{name.replace(/_/g, " ")}</span>
                <span className="sub-score">{score === null ? "—" : score.toFixed(0)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prognosis & Mission Reliability */}
      <div className="section-block">
        <div className="section-title">Prognosis</div>
        <div className="prognosis-box">
          <div className="prog-metric-row">
            <span className="prog-k">Remaining Life</span>
            <span className="prog-v highlight-text">{fmtSec(prognosis.rulSec)}</span>
          </div>
          <div className="prog-metric-row">
            <span className="prog-k">Mission Success</span>
            <span className="prog-v">{mission.pSuccess === null ? "—" : `${Math.round(mission.pSuccess * 100)}%`}</span>
          </div>
          <div className="prog-metric-row">
            <span className="prog-k">Safe Endurance</span>
            <span className="prog-v">{fmtSec(mission.safeEnduranceSec)}</span>
          </div>
          <div className="rec-badge-wrapper">
            <span className={`rec-badge rec-${mission.recommendation}`}>
              {mission.recommendation.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mission-meta">
            <span className={`conf conf-${mission.confidence}`}>{mission.confidence} confidence</span>
            <span className="basis">{mission.basis.replace(/_/g, " ")}</span>
          </div>
        </div>
      </div>

      {/* EHI Overall Gauge */}
      <div className="ehi-banner">
        <div className="ehi-banner-text">Engine Health Index</div>
        <div className={`ehi-banner-val ${getEhiGrade(health.ehi)}`}>
          {health.ehi === null ? "—" : `${Math.round(health.ehi)}%`}
        </div>
      </div>
    </div>
  );
}
