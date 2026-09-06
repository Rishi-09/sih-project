/**
 * Mirrors server/src/types.ts / contract/types.ts. Keep in sync — a shape
 * change needs the freeze ritual (published plan §B2).
 */
export interface FlightContext {
  alt_m: number;
  ias_kt: number;
  oat_c: number;
  throttle_pct: number;
}

/**
 * null means NOT YET KNOWN, not "fine". The ML backend only emits a health
 * evaluation every few simulated seconds, and before the first one arrives
 * there is no health figure — reporting 100 there claimed a perfect engine on
 * the strength of no data at all, which is the most dangerous possible default
 * for a health monitor.
 */
export interface HealthBlock {
  ehi: number | null;
  subsystems: {
    lubrication: number | null;
    cooling: number | null;
    combustion: number | null;
    fuel: number | null;
    mechanical: number | null;
    induction: number | null;
    electrical: number | null;
    injection: number | null;
  };
}

export interface SensorFaultBlock {
  channel: string | null;
  mode: "frozen" | "drift" | "dropout" | "spike" | null;
  confidence: number;
}

export interface DiagnosisBlock {
  label: string;
  confidence: number;
  probs: Record<string, number>;
  anomalyScore: number;
  cylinder: number | null;
  sensorFault: SensorFaultBlock;
}

export interface PrognosisBlock {
  rulSec: number | null;
  rulLoSec: number | null;
  rulHiSec: number | null;
  basis: string;
}

/**
 * One channel's standing in the reliability projection. limiters[0] is the
 * BINDING constraint — the single reason the mission is or is not at risk, and
 * what the console leads with.
 */
export interface ReliabilityLimiter {
  channel: string;
  subsystem: string;
  unit: string;
  value: number;
  limit: number;
  limitKind: "high" | "low";
  headroomPct: number; // 100 = at the normal-band edge, 0 = at the limit
  beyondCaution: boolean; // already operating past the caution threshold
  ratePerMin: number; // signed drift per minute, net of throttle
  secondsToLimit: number | null; // null = not trending toward the limit
}

/**
 * Mission reliability. `null` on every numeric field means NOT YET ASSESSED —
 * the projection needs roughly a minute of telemetry before it can measure a
 * trend, and until then there is no probability to report. It previously filled
 * that gap with `ehi / 100` and a "continue" recommendation, which is a
 * confident-looking answer built on no projection at all.
 *
 * `recommendation: "assessing"` is the matching verdict: we are not advising
 * anything yet, as distinct from advising that the mission proceed.
 */
export interface MissionBlock {
  pSuccess: number | null;
  pSuccessLo: number | null;
  pSuccessHi: number | null;
  recommendation: "assessing" | "continue" | "derate" | "return_to_base" | "land_immediately";
  reason: string;
  safeEnduranceSec: number | null;
  missionRemainingSec: number;
  derateTo: number | null;
  confidence: "low" | "medium" | "high";
  basis: string;
  limiters: ReliabilityLimiter[];
}

export interface WhatIfResult {
  powerPct: number;
  pSuccess: number | null; // null while the projection is still warming up
  safeEnduranceSec: number | null;
  basis: string;
}

export interface AlertPayload {
  code: string;
  severity: "caution" | "critical";
  channel: string;
  message: string;
}

export interface TickFrame {
  contractVersion: string;
  runId: string;
  t: number;
  ts: string;
  phase: string;
  sensors: Record<string, number>;
  context: FlightContext;
  nominal: Record<string, number>;
  residualZ: Record<string, number>;
  health: HealthBlock;
  diagnosis: DiagnosisBlock;
  prognosis: PrognosisBlock;
  mission: MissionBlock;
  alerts: AlertPayload[];
  /** Faults commanded through the console for this run, in injection order.
   * GROUND TRUTH, not a prediction — `diagnosis.label` is the model's read of
   * the same situation and the two are meant to be compared. Always empty in
   * real operation; nothing injects faults into a real engine. */
  injectedFaults: string[];
}

// 19 engine channels — the original count. No factory per-cylinder CHT on the
// Rotax 915 iS (liquid-cooled heads) — cht_1..4 here are a DERIVED/MODELED
// estimate from coolant_temp_c + EGT + fuel flow, not raw sensors (team
// decision; see /contract/sensors.json).
export const ENGINE_CHANNELS = [
  "rpm", "map_kpa",
  "egt_1", "egt_2", "egt_3", "egt_4",
  "cht_1", "cht_2", "cht_3", "cht_4",
  "oil_press_bar", "oil_temp_c", "coolant_temp_c",
  "fuel_flow_lph", "fuel_press_bar", "inj_timing_deg",
  "vib_rms_g", "bus_voltage_v", "alt_current_a",
] as const;

export const CHANNEL_UNITS: Record<string, string> = {
  rpm: "rpm", map_kpa: "kPa",
  egt_1: "°C", egt_2: "°C", egt_3: "°C", egt_4: "°C",
  cht_1: "°C", cht_2: "°C", cht_3: "°C", cht_4: "°C",
  oil_press_bar: "bar", oil_temp_c: "°C", coolant_temp_c: "°C",
  fuel_flow_lph: "L/h", fuel_press_bar: "bar", inj_timing_deg: "°BTDC",
  vib_rms_g: "g", bus_voltage_v: "V", alt_current_a: "A",
};

export interface EngineSummary {
  id: string;
  tail: string;
  model: string;
  latestRunId: string | null;
  latestRunStatus: string | null;
  ehi: number | null;
}
