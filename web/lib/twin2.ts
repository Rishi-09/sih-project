// Client + types for the twin2 API (python -m twin2.api, default :8100).
export const TWIN2_BASE = process.env.NEXT_PUBLIC_TWIN2_BASE ?? "http://localhost:8100";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${TWIN2_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

export type Verdict = "go" | "conditional_go" | "no_go" | "out_of_service";

export interface Cause {
  id: string;
  label: string;
  score: number;
  evidence: string[];
  check: string;
}

export interface FleetEngine {
  engine_id: string;
  serial: string;
  scripted: string;
  age_h: number;
  sorties: number;
  in_service: boolean;
  failed: boolean;
  failure_kind: string;
  deficit: number;
  deficit_trend_100h: number;
  worst_factor: string;
  level: number[];
  hours_to_thermal_limit: number | null;
  thermal_channel: string | null;
  hours_to_failure_threshold: number | null;
  failure_factor: string | null;
  top_cause: Cause | null;
  p_complete: number | null;
  verdict: Verdict;
}

export interface Fleet {
  engines: FleetEngine[];
  mission: { hours: number; power: number; target: number; oat_sl_c: number };
  model: { k: number; lambda_h: number; beta: Record<string, number>; n_events: number; n_intervals: number };
  health_factors: string[];
  fail_thresholds: number[];
  labels: Record<string, string>;
}

export interface SensorFault {
  channel: string;
  mode: string;
  confidence: number;
  onset_s: number | null;
  evidence: string;
}

export interface SortieRec {
  sortie: number;
  age_h: number;
  duration_h: number;
  power: number;
  commissioning: boolean;
  theta: number[];
  theta_sd: number[];
  deficit: number;
  worst_factor: string;
  deficit_trend_100h: number;
  attribution: "none" | "sensor" | "engine" | "both";
  sensor_faults: SensorFault[];
  cyl_dev: (number | null)[];
  hours_to_thermal_limit: number | null;
  thermal_channel: string | null;
  hours_to_failure_threshold: number | null;
  failure_factor: string | null;
  diagnosis: { causes: Cause[]; no_fault: number };
  hypotheses?: Record<string, number>;
}

export interface TruthRow {
  sortie: number;
  failed: boolean;
  failure_kind: string;
  sf_channel: string;
  sf_mode: string;
  active_faults: string;
  [k: `true_${string}`]: number;
}

export interface EngineDetail {
  engine: FleetEngine;
  sorties: SortieRec[];
  truth: TruthRow[];
  survival: { h: number; s: number }[];
  health_factors: string[];
  labels: Record<string, string>;
  fail_thresholds: number[];
}

export interface SortieDetail {
  record: SortieRec;
  truth: TruthRow & { sf_magnitude: number };
  telemetry: Record<string, number[]> & { t_s: number[]; phase: string[] };
  expected: Record<string, number[]>;
  segments: [number, number][];
  debrief_md: string;
}

export interface MissionOption {
  id: string;
  label: string;
  p_complete: number | null;
  p_lo?: number;
  p_hi?: number;
  verdict: Verdict;
  time_on_station_cost_h: number;
}

export interface MissionAdvice {
  engine_id: string;
  p_complete: number;
  p_lo: number;
  p_hi: number;
  verdict: Verdict;
  target: number;
  thermal_ok: boolean;
  thermal_detail: string;
  drivers: { driver: string; detail: string; hazard?: number; hazard_multiplier?: number }[];
  options: MissionOption[];
  fleet_ranking: { engine_id: string; p_complete: number; verdict: Verdict; age_h: number; deficit: number }[];
  in_service: boolean;
  mission: { hours: number; power: number; target: number; oat_sl_c: number };
}

export interface Reflection {
  validation: {
    attribution: {
      n_events: number; accuracy: number; sensor_cases: number; sensor_accuracy: number;
      engine_cases: number; engine_accuracy: number; false_sensor_rate_normal: number;
      false_engine_rate_normal: number; n_normal: number; commissioning_sensor_faults_missed: number;
    };
    slow_faults: {
      per_kind: Record<string, { engine_id: string; factor: string; detected_at_h: number | null;
        limit_at_h: number | null; lead_h: number | null; detected_before_limit: boolean }[]>;
      kinds_detected_before_limit: number; kinds_present: number;
    };
    diagnosis_top3: { n: number; accuracy: number; per_cause: Record<string, number> };
    p_complete: { n: number; brier: number; mean_p: number; realized: number; failures: number };
    robustness?: Record<string, number>;
  };
  calibration: { bins: { bin: string; n: number; predicted: number; realized: number; failures: number }[];
    brier: number; brier_climatology: number; skill: number | null };
  ledger: { model: string; kind: string; n: number; resolved: number; accuracy: number | null }[];
  model: Fleet["model"];
}

export const twin2 = {
  fleet: () => req<Fleet>("/api/twin2/fleet"),
  engine: (id: string) => req<EngineDetail>(`/api/twin2/engine/${id}`),
  sortie: (id: string, n: number) => req<SortieDetail>(`/api/twin2/sortie/${id}/${n}`),
  mission: (body: { engine_id: string; hours: number; power: number; target: number; oat_sl_c: number }) =>
    req<MissionAdvice>("/api/twin2/mission", { method: "POST", body: JSON.stringify(body) }),
  reflection: () => req<Reflection>("/api/twin2/reflection"),
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  go: "Go",
  conditional_go: "Conditional go",
  no_go: "No-go",
  out_of_service: "Out of service",
};

export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(100 * v).toFixed(d)}%`);
