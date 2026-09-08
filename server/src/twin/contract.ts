import fs from "fs";
import path from "path";

/**
 * server/contract/sensors.json and server/contract/faults.json are committed
 * COPIES of the monorepo's top-level /contract/*.json (which is itself R1's
 * Retribution simulator's sensors.json, verbatim — team decision, 2026-09-01).
 *
 * They live inside server/ rather than being read from ../../../contract via
 * __dirname, because that path assumes the whole monorepo is present at
 * runtime — true in local dev, false on any host that deploys `server/` as its
 * own build root (Railway, Render, a Docker build context scoped to server/,
 * ...). There, /contract sits outside the build context entirely and the file
 * is simply never copied in: `ENOENT /contract/sensors.json` in production,
 * working fine in dev, is exactly that failure mode.
 *
 * Consequence: this copy can drift from the monorepo original. If R1's
 * sensors.json or faults.json changes, re-run:
 *   cp contract/sensors.json contract/faults.json server/contract/
 * from the repo root. Small enough not to automate for an MVP.
 *
 * This file is the ONLY place that adapts Retribution's raw shape (a
 * `channels` dict keyed by id, `normal_min`/`normal_max`/`caution_min`/
 * `caution_max`/`redline`/`redline_low`/`redline_high`/`source`) into the
 * internal SensorSpec shape the rest of this server was already built against.
 * Nothing downstream of this module (alerts.ts, stubTwin.ts, routes/) needs to
 * know the raw file's shape — or its numbers — changed.
 */
interface RawChannel {
  type: "context" | "engine";
  subsystem?: string;
  unit: string;
  source?: "measured" | "estimated" | "derived";
  description?: string;
  note?: string;
  normal_min?: number;
  normal_max?: number;
  caution_min?: number;
  caution_max?: number;
  redline?: number;
  redline_low?: number;
  redline_high?: number;
}
interface RawSensorFile {
  contract_version: string;
  engine_model: string;
  total_channels: number;
  context_channels_count: number;
  engine_sensor_channels_count: number;
  subsystems: Record<string, string[]>;
  channels: Record<string, RawChannel>;
}

export interface SensorSpec {
  id: string;
  unit: string;
  subsystem: string;
  cylinder?: number;
  min?: number; // hard low limit — Retribution's redline_low, if any
  max?: number; // hard high limit — Retribution's redline, or redline_high
  cautionMin?: number;
  cautionMax?: number;
  normalMin?: number; // Retribution's normal_min — typical/expected operating floor
  normalMax?: number; // Retribution's normal_max — typical/expected operating ceiling
  estimated?: boolean; // true for cht_1..4 — not an independent sensor, see stubTwin.step()
  note?: string;
}
export interface SensorContract {
  engine: SensorSpec[];
  phases: string[];
}

// server/contract/, not ../../../contract — see the file-header comment above.
// __dirname is server/src/twin in dev (tsx) and server/dist/twin once built
// (tsc mirrors the src/ tree under dist/), so "../../contract" reaches
// server/contract in both cases.
const contractPath = path.join(__dirname, "../../contract/sensors.json");
const raw: RawSensorFile = JSON.parse(fs.readFileSync(contractPath, "utf-8"));

function toSpec(id: string, ch: RawChannel): SensorSpec {
  const cylinderMatch = /_(\d)$/.exec(id);
  return {
    id,
    unit: ch.unit,
    subsystem: ch.subsystem ?? "",
    cylinder: cylinderMatch ? Number(cylinderMatch[1]) : undefined,
    min: ch.redline_low,
    max: ch.redline ?? ch.redline_high,
    cautionMin: ch.caution_min,
    cautionMax: ch.caution_max,
    normalMin: ch.normal_min,
    normalMax: ch.normal_max,
    estimated: ch.source === "estimated" || ch.source === "derived",
    note: ch.note,
  };
}

export const sensorContract: SensorContract = {
  engine: Object.entries(raw.channels)
    .filter(([, ch]) => ch.type === "engine")
    .map(([id, ch]) => toSpec(id, ch)),
  phases: ["startup", "taxi", "takeoff", "climb", "cruise", "loiter", "descent", "approach", "shutdown"],
};
export const SPEC_BY_ID = new Map(sensorContract.engine.map((s) => [s.id, s]));

export interface ResolvedLimits {
  min?: number;
  max?: number;
  cautionMin?: number;
  cautionMax?: number;
}

/**
 * Resolves a channel's alert bounds. Every bound now comes straight from
 * /contract/sensors.json (Retribution's file) via toSpec() above — Retribution
 * states flat redlines for every channel, including oil pressure, so the
 * earlier manual-derived RPM-conditional oil-pressure floor is retired along
 * with the old contract file. See CONTEXT.md "Revision 4" for what changed and
 * why. `sensors` is accepted but unused — kept so existing call sites
 * (alerts.ts, stubTwin.ts) don't need to change.
 */
export function resolveLimits(spec: SensorSpec, _sensors?: Record<string, number>): ResolvedLimits {
  return { min: spec.min, max: spec.max, cautionMin: spec.cautionMin, cautionMax: spec.cautionMax };
}

/**
 * /contract/faults.json is a transcription of ../Retribution/simulator/faults.py
 * (FaultManager._build_profiles) — Retribution ships the fault taxonomy only as
 * Python code, not a data file, so unlike sensors.json this one isn't a verbatim
 * copy. Every id/delaySec/rampSec/delta/shape here must match faults.py exactly.
 * stubTwin.ts drives its entire fault cascade off this data — no per-fault
 * switch statement — so a new or changed fault in faults.py only needs its
 * cascade transcribed here to take effect.
 */
export interface FaultCascadeStep {
  channel: string;
  delaySec: number;
  rampSec: number;
  delta: number;
  shape: "linear" | "exponential" | "step";
}
export interface FaultClass {
  id: string;
  label: string;
  subsystems: string[];
  cylinder?: number;
  cascade?: FaultCascadeStep[];
}
export interface SensorFaultSpec {
  id: string;
  label: string;
  channel: string;
  mode: "frozen" | "drift";
  delaySec?: number;
  rampSec?: number;
  delta?: number;
  note?: string;
}
interface RawFaultsFile {
  classes: FaultClass[];
  sensorFaults: SensorFaultSpec[];
}

const faultsPath = path.join(__dirname, "../../contract/faults.json"); // server/contract/, see above
const rawFaults: RawFaultsFile = JSON.parse(fs.readFileSync(faultsPath, "utf-8"));

export const FAULT_CLASSES: FaultClass[] = rawFaults.classes;
export const FAULT_CLASS_BY_ID = new Map(FAULT_CLASSES.map((f) => [f.id, f]));
export const SENSOR_FAULTS: SensorFaultSpec[] = rawFaults.sensorFaults;
export const SENSOR_FAULT_BY_ID = new Map(SENSOR_FAULTS.map((f) => [f.id, f]));
export const ENGINE_FAULT_IDS = FAULT_CLASSES.filter((f) => f.id !== "healthy").map((f) => f.id);
export const SENSOR_FAULT_IDS = SENSOR_FAULTS.map((f) => f.id);
