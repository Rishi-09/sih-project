/**
 * Shared TickFrame contract — source of truth for the shape both `server` and `web`
 * agree on. Duplicated (not imported via a workspace) into server/src/types.ts and
 * web/lib/types.ts to keep each project independently runnable; keep all three in sync.
 *
 * contractVersion bump rule: any shape change here requires bumping this string AND
 * regenerating anything that hardcodes the shape (stub twin, mock fixtures). See
 * the published plan, §B2, "the freeze ritual."
 */
export const CONTRACT_VERSION = "1.0.0";

export interface FlightContext {
  alt_m: number;
  ias_kt: number;
  oat_c: number;
  throttle_pct: number;
}

export interface HealthBlock {
  ehi: number;
  subsystems: {
    lubrication: number;
    cooling: number;
    combustion: number;
    inductionFuel: number;
    mechanical: number;
    electrical: number;
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
  sensors: Record<string, number>; // 19 engine channels, see contract/sensors.json
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

export const SUBSYSTEMS: Record<string, readonly string[]> = {
  lubrication: ["oil_press_bar", "oil_temp_c"],
  cooling: ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
  combustion: ["egt_1", "egt_2", "egt_3", "egt_4"],
  induction_fuel: ["map_kpa", "fuel_press_bar", "fuel_flow_lph", "inj_timing_deg"],
  mechanical: ["vib_rms_g", "rpm"],
  electrical: ["bus_voltage_v", "alt_current_a"],
};
