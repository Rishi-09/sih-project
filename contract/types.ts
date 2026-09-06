/**
 * Shared TickFrame contract — source of truth for the shape both `server` and `web`
 * agree on. Duplicated (not imported via a workspace) into server/src/types.ts and
 * web/lib/types.ts to keep each project independently runnable; keep all three in sync.
 *
 * contractVersion bump rule: any shape change here requires bumping this string AND
 * regenerating anything that hardcodes the shape (stub twin, mock fixtures). See
 * the published plan, §B2, "the freeze ritual."
 */
export const CONTRACT_VERSION = "1.1.0";

export interface FlightContext {
  alt_m: number;
  ias_kt: number;
  oat_c: number;
  throttle_pct: number;
}

// 8 categories — matches Retribution's ML/docs/ML_BACKEND_HANDOFF.md §4
// subsystem_scores exactly (source of truth); induction_fuel split into
// induction/fuel/injection.
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
  label: string; // one of faults.json classes[].id
  confidence: number;
  probs: Record<string, number>;
  anomalyScore: number;
  cylinder: number | null; // only set for ignition_fault_cyl3 / injector_fault_cyl3 — always 3 today
  sensorFault: SensorFaultBlock;
}

export interface PrognosisBlock {
  rulSec: number | null;
  rulLoSec: number | null;
  rulHiSec: number | null;
  basis: string;
}

/**
 * One channel's standing in the reliability projection: where it is, where its
 * limit is, and how long until the measured drift gets it there. The top entry
 * of MissionBlock.limiters is the BINDING constraint — the single reason the
 * mission is or is not at risk.
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
 * Mission reliability — computed by server/src/twin/reliability.ts, which
 * projects every channel's throttle-conditioned trend against the power
 * schedule of the REMAINING mission. Superset of the previous 1.0.0 shape:
 * pSuccess/recommendation/safeEnduranceSec/derateTo keep their meaning and
 * their old consumers, the rest is new evidence behind the number.
 */
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
  reason: string; // one plain sentence an operator can act on
  safeEnduranceSec: number | null; // P90 survival time, not a mean
  missionRemainingSec: number;
  derateTo: number | null; // mildest power setting that restores the margin
  confidence: "low" | "medium" | "high";
  basis: string;
  limiters: ReliabilityLimiter[]; // most urgent first
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
  sensors: Record<string, number>; // 19 engine channels, see contract/sensors.json
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

// 19 engine channels — the original count. The Rotax 915 iS has liquid-cooled
// cylinder heads with no factory per-cylinder CHT sensor (see
// /contract/sensors.json _correction) — cht_1..4 are restored here as
// DERIVED/MODELED estimates (from coolant_temp_c + EGT + fuel flow), not raw
// sensors, by team decision. The manual's own "EGT-Split" concept (per-cylinder
// EGT deviation from the mean) drives that derivation internally rather than
// existing as its own 20th top-level channel.
export const ENGINE_CHANNELS = [
  "rpm", "map_kpa",
  "egt_1", "egt_2", "egt_3", "egt_4",
  "cht_1", "cht_2", "cht_3", "cht_4",
  "oil_press_bar", "oil_temp_c", "coolant_temp_c",
  "fuel_flow_lph", "fuel_press_bar", "inj_timing_deg",
  "vib_rms_g", "bus_voltage_v", "alt_current_a",
] as const;

export const SUBSYSTEMS: Record<string, readonly string[]> = {
  lubrication: ["oil_press_bar", "oil_temp_c"],
  cooling: ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
  combustion: ["egt_1", "egt_2", "egt_3", "egt_4"],
  induction_fuel: ["map_kpa", "fuel_press_bar", "fuel_flow_lph", "inj_timing_deg"],
  mechanical: ["vib_rms_g", "rpm"],
  electrical: ["bus_voltage_v", "alt_current_a"],
};
