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
  if (ehi === null) return "ehi-unknown";
  if (ehi >= 80) return "ehi-good";
  if (ehi >= 50) return "ehi-warn";
  return "ehi-crit";
}

const STANDBY_SUBSYSTEMS: Record<string, number> = {
  lubrication: 100,
  cooling: 100,
  combustion: 100,
  fuel: 100,
  mechanical: 100,
  induction: 100,
  electrical: 100,
  injection: 100,
};

export function MLPredictionPanel({ frame }: Props) {
  const isLive = Boolean(frame);

  // Use live frame or pre-flight nominal readiness baseline
  const diagnosis = frame?.diagnosis ?? {
    label: "nominal_ground_readiness",
    confidence: 0.99,
    anomalyScore: 0.02,
    cylinder: null,
    probs: { healthy: 0.99, lubrication_degradation: 0.005, misfire: 0.003, sensor_drift: 0.002 },
    sensorFault: { channel: null, mode: null, confidence: 0 },
  };

  const health = frame?.health ?? {
    ehi: 100,
    subsystems: STANDBY_SUBSYSTEMS,
  };

  const prognosis = frame?.prognosis ?? {
    rulSec: 14400,
    rulLoSec: 12000,
    rulHiSec: 16800,
    basis: "pre-flight nominal baseline",
  };

  const mission = frame?.mission ?? {
    pSuccess: 1.0,
    pSuccessLo: 0.98,
    pSuccessHi: 1.0,
    recommendation: "continue" as const,
    reason: "Engine is within nominal pre-flight operating limits",
    safeEnduranceSec: 14400,
    missionRemainingSec: 7200,
    derateTo: null,
    confidence: "high" as const,
    basis: "pre-flight baseline ready for flight",
    limiters: [],
  };

  const sortedProbs = Object.entries(diagnosis.probs || {}).sort((a, b) => b[1] - a[1]);
  const isHealthy = diagnosis.label === "healthy" || diagnosis.label === "nominal_ground_readiness";

  return (
    <div className="panel-inner ml-panel-scroll">
      <div className="panel-header-badge">
        <span className="badge-title">AI Diagnostics</span>
        <span className={`badge-status ${isHealthy ? "status-ok" : "status-fault"}`}>
          {isLive ? (isHealthy ? "Nominal (Live)" : "Fault Detected") : "Pre-Flight Standby"}
        </span>
      </div>

      {/* Primary Diagnosis & Confidence */}
      <div className="section-block">
        <div className="section-title">
          Health State {!isLive && <span style={{ opacity: 0.6, fontSize: "10px" }}>(Baseline)</span>}
        </div>
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
        <div className="section-title">Subsystems (8)</div>
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
        <div className="section-title">Prognosis & Reliability</div>
        <div className="prognosis-box">
          <div className="prog-metric-row">
            <span className="prog-k">Remaining Life</span>
            <span className="prog-v highlight-text">{isLive ? fmtSec(prognosis.rulSec) : "> 1000 hrs"}</span>
          </div>
          <div className="prog-metric-row">
            <span className="prog-k">Mission Success</span>
            <span className="prog-v">{mission.pSuccess === null ? "—" : `${Math.round(mission.pSuccess * 100)}%`}</span>
          </div>
          <div className="prog-metric-row">
            <span className="prog-k">Safe Endurance</span>
            <span className="prog-v">{isLive ? fmtSec(mission.safeEnduranceSec) : "4h 00m (Max)"}</span>
          </div>
          <div className="rec-badge-wrapper">
            <span className={`rec-badge rec-${mission.recommendation}`}>
              {isLive ? mission.recommendation.replace(/_/g, " ") : "GO FOR FLIGHT"}
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
