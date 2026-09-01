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
