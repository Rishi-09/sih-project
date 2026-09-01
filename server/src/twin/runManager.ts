import { prisma } from "../db/client";
import { TwinRun } from "./stubTwin";
import { AlertEngine } from "./alerts";
import { StartRunRequest, FaultRequest, TickFrame } from "../types";

type RunStatus = "live" | "degraded" | "stopped";

interface RunEntry {
  twin: TwinRun;
  alertEngine: AlertEngine;
  status: RunStatus;
  frameBuffer: TickFrame[]; // last ~300 frames — chat/report context
  pendingFrames: TickFrame[]; // batched, flushed to SQLite every 5 ticks
}

const runs = new Map<string, RunEntry>();
const FLUSH_EVERY = 5;
const BUFFER_SIZE = 300;

export async function startRun(req: StartRunRequest): Promise<{ runId: string }> {
  const engine = await prisma.engine.findUnique({ where: { id: req.engineId } });
  if (!engine) throw new Error(`Unknown engineId ${req.engineId}`);

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

  const twin = new TwinRun(dbRun.id, req.engineId, seed, req.scenario ?? "custom", req.missionProfile);
  runs.set(dbRun.id, { twin, alertEngine: new AlertEngine(), status: "live", frameBuffer: [], pendingFrames: [] });
  return { runId: dbRun.id };
}

export function injectFault(runId: string, req: FaultRequest) {
  const entry = runs.get(runId);
  if (!entry) throw new Error(`Unknown or inactive runId ${runId}`);
  entry.twin.injectFault(req);
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
  await prisma.run.update({ where: { id: runId }, data: { status: "stopped", endedAt: new Date() } });
  runs.delete(runId);
}

export function stepRun(runId: string): TickFrame | null {
  const entry = runs.get(runId);
  if (!entry || entry.status !== "live") return null;

  const frame = entry.twin.step();
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
