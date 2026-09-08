"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRun = startRun;
exports.reapOrphanedRuns = reapOrphanedRuns;
exports.injectFault = injectFault;
exports.clearFaults = clearFaults;
exports.isActive = isActive;
exports.getStatus = getStatus;
exports.setStatus = setStatus;
exports.stopRun = stopRun;
exports.stepRun = stepRun;
exports.getFrameBuffer = getFrameBuffer;
exports.getLatestFrame = getLatestFrame;
exports.getReliability = getReliability;
const client_1 = require("../db/client");
const stubTwin_1 = require("./stubTwin");
const opsClient_1 = require("./opsClient");
const alerts_1 = require("./alerts");
const reliability_1 = require("./reliability");
const runs = new Map();
const FLUSH_EVERY = 5;
const BUFFER_SIZE = 300;
/**
 * Real backend by default — set TWIN_BACKEND=stub to force the placeholder
 * physics/math instead (e.g. if retribution/run_ws_only.py isn't running).
 * If the real backend is selected but unreachable, startRun() falls back to
 * the stub automatically rather than failing the run outright — same
 * "never show an error on stage" principle as the AI advisory offline path.
 */
async function startRun(req) {
    const engineRow = await client_1.prisma.engine.findUnique({ where: { id: req.engineId } });
    if (!engineRow)
        throw new Error(`Unknown engineId ${req.engineId}`);
    const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);
    const dbRun = await client_1.prisma.run.create({
        data: {
            engineId: req.engineId,
            scenario: req.scenario ?? "custom",
            seed,
            contractVersion: "1.0.0",
            missionProfile: JSON.stringify(req.missionProfile ?? {}),
            status: "live",
        },
    });
    let engine;
    let mode;
    // The mission the reliability engine projects against must be the mission
    // actually being flown. The ops backend flies its own autopilot schedule, not
    // the caller's profile and not the stub's default.
    let missionProfile = req.missionProfile;
    if (process.env.TWIN_BACKEND === "stub") {
        engine = new stubTwin_1.TwinRun(dbRun.id, req.engineId, seed, req.scenario ?? "custom", req.missionProfile);
        mode = "stub";
    }
    else {
        const ops = new opsClient_1.OpsClient(dbRun.id, seed);
        try {
            await ops.connect();
            engine = ops;
            mode = "ops";
            missionProfile = (0, opsClient_1.opsMissionProfile)();
        }
        catch (err) {
            console.error(`ops backend unreachable, falling back to stub twin for run ${dbRun.id}:`, err.message);
            engine = new stubTwin_1.TwinRun(dbRun.id, req.engineId, seed, req.scenario ?? "custom", req.missionProfile);
            mode = "stub";
        }
    }
    runs.set(dbRun.id, {
        engine,
        mode,
        alertEngine: new alerts_1.AlertEngine(),
        // One reliability engine per run, fed every tick in finishTick(). It lives
        // here rather than inside either backend on purpose: the stub and the real
        // ops/ML backend then produce the SAME reliability assessment from the same
        // code, instead of each computing its own `ehi/100` separately.
        reliability: new reliability_1.ReliabilityEngine(missionProfile),
        status: "live",
        frameBuffer: [],
        pendingFrames: [],
        lastFrameT: null,
    });
    return { runId: dbRun.id };
}
/**
 * Marks every run still recorded as live as stopped.
 *
 * A run's live state lives in the in-process `runs` map; the database row only
 * mirrors it. So any row still saying "live" at startup belongs to a process
 * that no longer exists and can never produce another frame — during
 * development that is every `tsx watch` reload.
 *
 * Left uncleaned they are worse than clutter: /api/engines keeps advertising
 * the newest one as the engine's current run, the console auto-subscribes to
 * it, and the operator sits on "Waiting for telemetry…" forever for a sortie
 * that ended when the file watcher fired. Twelve had piled up before this
 * existed.
 */
async function reapOrphanedRuns() {
    const { count } = await client_1.prisma.run.updateMany({
        where: { status: "live" },
        data: { status: "stopped", endedAt: new Date() },
    });
    return count;
}
function injectFault(runId, req) {
    const entry = runs.get(runId);
    if (!entry)
        throw new Error(`Unknown or inactive runId ${runId}`);
    entry.engine.injectFault(req);
}
function clearFaults(runId) {
    const entry = runs.get(runId);
    if (!entry)
        throw new Error(`Unknown or inactive runId ${runId}`);
    entry.engine.clearFaults();
}
function isActive(runId) {
    return runs.has(runId);
}
function getStatus(runId) {
    return runs.get(runId)?.status;
}
function setStatus(runId, status) {
    const entry = runs.get(runId);
    if (entry)
        entry.status = status;
}
async function stopRun(runId) {
    const entry = runs.get(runId);
    if (!entry)
        return;
    await flush(runId);
    if (entry.mode === "ops")
        entry.engine.close();
    await client_1.prisma.run.update({ where: { id: runId }, data: { status: "stopped", endedAt: new Date() } });
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
function stepRun(runId) {
    const entry = runs.get(runId);
    if (!entry || entry.status !== "live")
        return null;
    if (entry.mode === "ops") {
        const latest = entry.engine.getLatestFrame();
        if (!latest)
            return null; // startup grace period — server_ops hasn't ticked yet
        if (entry.lastFrameT === latest.t) {
            // Re-broadcast of a frame we have already processed. It must carry the
            // alerts AND the mission/prognosis assessment computed for it — the raw
            // OpsClient frame still holds PENDING_MISSION, and returning that made
            // the console drop to "assessing" (previously: a fabricated 100%
            // "continue") every time the simulator had not advanced a full second
            // between our 1 Hz polls, which is most ticks at low speed multipliers.
            const lastPersisted = entry.frameBuffer[entry.frameBuffer.length - 1];
            if (!lastPersisted)
                return null;
            return {
                ...latest,
                alerts: lastPersisted.alerts,
                mission: lastPersisted.mission,
                prognosis: lastPersisted.prognosis,
            };
        }
        entry.lastFrameT = latest.t;
        return finishTick(entry, runId, latest);
    }
    return finishTick(entry, runId, entry.engine.step());
}
function finishTick(entry, runId, frame) {
    const result = entry.alertEngine.evaluate(frame);
    frame.alerts = result.openAlerts;
    // Reliability runs AFTER alerts because an open critical alert is decisive
    // evidence in the recommendation ladder — a channel already past its limit
    // outranks any probability the projection produces. Whatever mission block
    // the backend supplied is replaced: neither backend has the mission profile,
    // the trend history, or the limit set needed to compute this properly.
    entry.reliability.ingest(frame);
    frame.mission = entry.reliability.evaluate(frame);
    // RUL band from the reliability engine's Monte Carlo crossing-time
    // distribution. Both backends previously drew their band as rul*0.7 / rul*1.4
    // around a point estimate — an interval that measured nothing. The point
    // estimate itself is kept when a backend supplies one (the ML's own RUL head
    // is a real model output); only the interval is replaced, and it stays null
    // when no trial breaches a limit inside the horizon.
    const band = entry.reliability.prognosis(frame);
    frame.prognosis = {
        rulSec: frame.prognosis.rulSec ?? band.rulSec,
        rulLoSec: band.rulLoSec,
        rulHiSec: band.rulHiSec,
        basis: frame.prognosis.rulSec !== null ? `${frame.prognosis.basis}+mc_band` : band.basis,
    };
    entry.frameBuffer.push(frame);
    if (entry.frameBuffer.length > BUFFER_SIZE)
        entry.frameBuffer.shift();
    entry.pendingFrames.push(frame);
    for (const a of result.newAlerts) {
        client_1.prisma.alert
            .create({ data: { runId, t: frame.t, code: a.code, severity: a.severity, channel: a.channel, message: a.message } })
            .catch((e) => console.error("alert persist failed", e));
    }
    for (const code of result.clearedCodes) {
        client_1.prisma.alert
            .updateMany({ where: { runId, code, clearedAtT: null }, data: { clearedAtT: frame.t } })
            .catch((e) => console.error("alert clear failed", e));
    }
    if (entry.pendingFrames.length >= FLUSH_EVERY)
        flush(runId).catch((e) => console.error("frame flush failed", e));
    return frame;
}
function getFrameBuffer(runId) {
    return runs.get(runId)?.frameBuffer ?? [];
}
function getLatestFrame(runId) {
    const buf = runs.get(runId)?.frameBuffer;
    return buf && buf.length > 0 ? buf[buf.length - 1] : undefined;
}
/** Exposed for the /whatif route, which re-runs the projection at a different
 * power setting against this run's already-accumulated trend history. */
function getReliability(runId) {
    return runs.get(runId)?.reliability;
}
async function flush(runId) {
    const entry = runs.get(runId);
    if (!entry || entry.pendingFrames.length === 0)
        return;
    const batch = entry.pendingFrames.splice(0, entry.pendingFrames.length);
    await client_1.prisma.frame.createMany({
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
            // Nullable in the schema: a frame recorded before the ML produced its
            // first evaluation has no EHI, and writing 100 there would poison every
            // later chart and post-flight report with invented perfect health.
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
//# sourceMappingURL=runManager.js.map