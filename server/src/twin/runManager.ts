import { prisma } from "../db/client";
import { TwinRun } from "./stubTwin";
import { OpsClient } from "./opsClient";
import { AlertEngine } from "./alerts";
import { StartRunRequest, FaultRequest, TickFrame } from "../types";

type RunStatus = "live" | "degraded" | "stopped";
type EngineBackend = TwinRun | OpsClient;

interface RunEntry {
  engine: EngineBackend;
  mode: "stub" | "ops";
  alertEngine: AlertEngine;
  status: RunStatus;
  frameBuffer: TickFrame[]; // last ~300 frames — chat/report context
  pendingFrames: TickFrame[]; // batched, flushed to SQLite every 5 ticks
  lastFrameT: number | null; // dedup guard for the ops pull path — see stepRun()
}

const runs = new Map<string, RunEntry>();
const FLUSH_EVERY = 5;
const BUFFER_SIZE = 300;

/**
 * Real backend by default — set TWIN_BACKEND=stub to force the placeholder
 * physics/math instead (e.g. if retribution/run_ws_only.py isn't running).
 * If the real backend is selected but unreachable, startRun() falls back to
 * the stub automatically rather than failing the run outright — same
 * "never show an error on stage" principle as the AI advisory offline path.
 */
export async function startRun(req: StartRunRequest): Promise<{ runId: string }> {
  const engineRow = await prisma.engine.findUnique({ where: { id: req.engineId } });
  if (!engineRow) throw new Error(`Unknown engineId ${req.engineId}`);

  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);
  const dbRun = await prisma.run.create({
    data: {
      engineId: req.engineId,
      scenario: req.scenario ?? "custom",
      seed,
      contractVersion: "1.0.0",
      missionProfile: JSON.stringify(req.missionProfile ?? {}),
      status: "live",
    },
  });

  let engine: EngineBackend;
  let mode: "stub" | "ops";
  if (process.env.TWIN_BACKEND === "stub") {
    engine = new TwinRun(dbRun.id, req.engineId, seed, req.scenario ?? "custom", req.missionProfile);
    mode = "stub";
  } else {
    const ops = new OpsClient(dbRun.id, seed);
    try {
      await ops.connect();
      engine = ops;
      mode = "ops";
    } catch (err) {
      console.error(`ops backend unreachable, falling back to stub twin for run ${dbRun.id}:`, (err as Error).message);
      engine = new TwinRun(dbRun.id, req.engineId, seed, req.scenario ?? "custom", req.missionProfile);
      mode = "stub";
    }
  }

  runs.set(dbRun.id, { engine, mode, alertEngine: new AlertEngine(), status: "live", frameBuffer: [], pendingFrames: [], lastFrameT: null });
  return { runId: dbRun.id };
}

export function injectFault(runId: string, req: FaultRequest) {
  const entry = runs.get(runId);
  if (!entry) throw new Error(`Unknown or inactive runId ${runId}`);
  entry.engine.injectFault(req);
}

export function isActive(runId: string): boolean {
  return runs.has(runId);
}

export function getStatus(runId: string): RunStatus | undefined {
  return runs.get(runId)?.status;
}

export function setStatus(runId: string, status: RunStatus) {
  const entry = runs.get(runId);
  if (entry) entry.status = status;
}

export async function stopRun(runId: string) {
  const entry = runs.get(runId);
  if (!entry) return;
  await flush(runId);
  if (entry.mode === "ops") (entry.engine as OpsClient).close();
  await prisma.run.update({ where: { id: runId }, data: { status: "stopped", endedAt: new Date() } });
  runs.delete(runId);
}

/**
 * Stub backend: pull-and-advance (twin.step() computes the next tick).
 * Ops backend: pull-only — server_ops pushes over its own WebSocket on its
 * own schedule (20Hz, sped up/down by its speed multiplier); this just reads
 * whatever OpsClient last received. If nothing new has arrived since the
 * previous call (timing jitter against the speed multiplier, not a fault),
 * the same frame is returned for broadcast but WITHOUT re-running
 * evaluate()/persistence — alerts.evaluate() is stateful (debounce ticks)
 * and re-feeding it an identical frame would double-count them.
 */
export function stepRun(runId: string): TickFrame | null {
  const entry = runs.get(runId);
  if (!entry || entry.status !== "live") return null;

  if (entry.mode === "ops") {
    const latest = (entry.engine as OpsClient).getLatestFrame();
    if (!latest) return null; // startup grace period — server_ops hasn't ticked yet
    if (entry.lastFrameT === latest.t) {
      const lastPersisted = entry.frameBuffer[entry.frameBuffer.length - 1];
      return { ...latest, alerts: lastPersisted?.alerts ?? [] };
    }
    entry.lastFrameT = latest.t;
    return finishTick(entry, runId, latest);
  }

  return finishTick(entry, runId, (entry.engine as TwinRun).step());
}

function finishTick(entry: RunEntry, runId: string, frame: TickFrame): TickFrame {
  const result = entry.alertEngine.evaluate(frame);
  frame.alerts = result.openAlerts;

  entry.frameBuffer.push(frame);
  if (entry.frameBuffer.length > BUFFER_SIZE) entry.frameBuffer.shift();
  entry.pendingFrames.push(frame);

  for (const a of result.newAlerts) {
    prisma.alert
      .create({ data: { runId, t: frame.t, code: a.code, severity: a.severity, channel: a.channel, message: a.message } })
      .catch((e) => console.error("alert persist failed", e));
  }
  for (const code of result.clearedCodes) {
    prisma.alert
      .updateMany({ where: { runId, code, clearedAtT: null }, data: { clearedAtT: frame.t } })
      .catch((e) => console.error("alert clear failed", e));
  }

  if (entry.pendingFrames.length >= FLUSH_EVERY) flush(runId).catch((e) => console.error("frame flush failed", e));

  return frame;
}

export function getFrameBuffer(runId: string): TickFrame[] {
  return runs.get(runId)?.frameBuffer ?? [];
}

export function getLatestFrame(runId: string): TickFrame | undefined {
  const buf = runs.get(runId)?.frameBuffer;
  return buf && buf.length > 0 ? buf[buf.length - 1] : undefined;
}

async function flush(runId: string) {
  const entry = runs.get(runId);
  if (!entry || entry.pendingFrames.length === 0) return;
  const batch = entry.pendingFrames.splice(0, entry.pendingFrames.length);
  await prisma.frame.createMany({
    data: batch.map((f) => ({
      runId,
      t: f.t,
      ts: new Date(f.ts),
      phase: f.phase,
      rpm: f.sensors.rpm,
      mapKpa: f.sensors.map_kpa,
      egt1: f.sensors.egt_1,
      egt2: f.sensors.egt_2,
      egt3: f.sensors.egt_3,
      egt4: f.sensors.egt_4,
      cht1: f.sensors.cht_1,
      cht2: f.sensors.cht_2,
      cht3: f.sensors.cht_3,
      cht4: f.sensors.cht_4,
      oilPressBar: f.sensors.oil_press_bar,
      oilTempC: f.sensors.oil_temp_c,
      coolantTempC: f.sensors.coolant_temp_c,
      fuelFlowLph: f.sensors.fuel_flow_lph,
      fuelPressBar: f.sensors.fuel_press_bar,
      injTimingDeg: f.sensors.inj_timing_deg,
      vibRmsG: f.sensors.vib_rms_g,
      busVoltageV: f.sensors.bus_voltage_v,
      altCurrentA: f.sensors.alt_current_a,
      context: JSON.stringify(f.context),
      residualZ: JSON.stringify(f.residualZ),
      health: JSON.stringify(f.health),
      ehi: f.health.ehi,
      faultLabel: f.diagnosis.label,
      confidence: f.diagnosis.confidence,
      rulSec: f.prognosis.rulSec ?? undefined,
      pSuccess: f.mission.pSuccess,
      sensorFaultChannel: f.diagnosis.sensorFault.channel ?? undefined,
      sensorFaultMode: f.diagnosis.sensorFault.mode ?? undefined,
    })),
  });
}
