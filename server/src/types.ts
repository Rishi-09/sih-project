/**
 * Mirrors /contract/types.ts — see that file for the "why duplicated" note.
 * Keep in sync; a shape change here needs the freeze ritual (published plan §B2).
 */
export const CONTRACT_VERSION = "1.0.0";

export interface FlightContext {
  alt_m: number;
  ias_kt: number;
  oat_c: number;
  throttle_pct: number;
}

// 8 subsystem categories — matches the real ML pipeline's subsystem_scores
// exactly (Retribution's ML/docs/ML_BACKEND_HANDOFF.md §4), adopted as source
// of truth rather than our earlier 6-category grouping: induction_fuel split
// into induction/fuel/injection.
export interface HealthBlock {
  ehi: number;
  subsystems: {
    lubrication: number;
    cooling: number;
    combustion: number;
    fuel: number;
    mechanical: number;
    induction: number;
    electrical: number;
    injection: number;
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

export interface MissionBlock {
  pSuccess: number;
  recommendation: "continue" | "derate" | "return_to_base" | "land_immediately";
  safeEnduranceSec: number;
  derateTo: number | null;
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

export type EngineChannel = (typeof ENGINE_CHANNELS)[number];

export const SUBSYSTEMS: Record<string, readonly string[]> = {
  lubrication: ["oil_press_bar", "oil_temp_c"],
  cooling: ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
  combustion: ["egt_1", "egt_2", "egt_3", "egt_4"],
  fuel: ["fuel_press_bar", "fuel_flow_lph"],
  mechanical: ["vib_rms_g", "rpm"],
  induction: ["map_kpa"],
  electrical: ["bus_voltage_v", "alt_current_a"],
  injection: ["inj_timing_deg"],
};

export interface MissionLeg {
  durationSec: number;
  powerPct: number;
}

export interface MissionProfile {
  legs: MissionLeg[];
}

export interface StartRunRequest {
  engineId: string;
  scenario?: string;
  seed?: number;
  missionProfile?: MissionProfile;
}

export interface FaultRequest {
  type: string;
  severity: number; // 0..1
  onsetDelay?: number; // seconds from now
  cylinder?: number; // accepted but currently ignored — ignition_fault_cyl3 /
  // injector_fault_cyl3 are hardcoded to cylinder 3 by contract/faults.json's
  // `cylinder` field (Retribution's own simulator hardcodes this too, see
  // SIMULATOR_CONTEXT.md §14), not client-selectable
}
