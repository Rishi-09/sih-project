"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunsRouter = createRunsRouter;
const express_1 = require("express");
const client_1 = require("../db/client");
const runManager_1 = require("../twin/runManager");
const contract_1 = require("../twin/contract");
const clock_1 = require("../twin/clock");
const client_2 = require("../ai/client");
const clocks = new Map();
/** Telemetry flows over the socket; control goes over REST — see published
 * plan §B5 for why (curl-debuggable, auditable in logs, easy to reason about
 * at 2am when the fault button does nothing). */
function createRunsRouter(io) {
    const router = (0, express_1.Router)();
    router.post("/", async (req, res) => {
        try {
            const body = req.body;
            if (!body.engineId) {
                res.status(400).json({ error: "engineId is required" });
                return;
            }
            const { runId } = await (0, runManager_1.startRun)(body);
            const clock = new clock_1.RunClock(runId, (frame) => io.to(`run:${runId}`).emit("frame", frame), () => {
                (0, runManager_1.setStatus)(runId, "degraded");
                io.to(`run:${runId}`).emit("run:status", { status: "degraded" });
            });
            clocks.set(runId, clock);
            clock.start();
            io.to(`run:${runId}`).emit("run:status", { status: "live" });
            res.status(201).json({ runId });
        }
        catch (err) {
            console.error(err);
            res.status(400).json({ error: err.message });
        }
    });
    /** Faults ACCUMULATE — POST twice with different types and both stay active,
     * which is how a compound failure is reproduced from the console. An id that
     * matches neither a fault class nor a sensor fault is now a 400 rather than a
     * silently-accepted no-op. */
    router.post("/:id/fault", (req, res) => {
        try {
            const body = req.body;
            if (!(0, runManager_1.isActive)(req.params.id)) {
                res.status(404).json({ error: "run not found or not active" });
                return;
            }
            if (!body?.type || (!contract_1.FAULT_CLASS_BY_ID.has(body.type) && !contract_1.SENSOR_FAULT_BY_ID.has(body.type))) {
                res.status(400).json({ error: `unknown fault type "${body?.type}"` });
                return;
            }
            (0, runManager_1.injectFault)(req.params.id, body);
            res.status(202).json({ ok: true });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    /** Clear every active fault without ending the sortie — the counterpart to
     * accumulation. Without it the only way back to a healthy engine was to stop
     * and restart the run. */
    router.delete("/:id/faults", (req, res) => {
        try {
            if (!(0, runManager_1.isActive)(req.params.id)) {
                res.status(404).json({ error: "run not found or not active" });
                return;
            }
            (0, runManager_1.clearFaults)(req.params.id);
            res.json({ ok: true });
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    router.post("/:id/stop", async (req, res) => {
        clocks.get(req.params.id)?.stop();
        clocks.delete(req.params.id);
        await (0, runManager_1.stopRun)(req.params.id);
        io.to(`run:${req.params.id}`).emit("run:status", { status: "stopped" });
        res.json({ status: "stopped" });
    });
    /** Is this run actually live in THIS process? The database's own status
     * cannot answer that — see reapOrphanedRuns. The console polls this while it
     * waits for a first frame so it can tell a slow start from a dead run. */
    router.get("/:id/status", (req, res) => {
        res.json({ active: (0, runManager_1.isActive)(req.params.id), status: (0, runManager_1.getStatus)(req.params.id) ?? "stopped" });
    });
    router.get("/:id/telemetry", async (req, res) => {
        const { from, to, step } = req.query;
        const frames = await client_1.prisma.frame.findMany({
            where: {
                runId: req.params.id,
                t: { gte: from ? Number(from) : undefined, lte: to ? Number(to) : undefined },
            },
            orderBy: { t: "asc" },
        });
        const stepN = step ? Number(step) : 1;
        const sampled = stepN > 1 ? frames.filter((f) => f.t % stepN === 0) : frames;
        res.json(sampled);
    });
    router.get("/:id/alerts", async (req, res) => {
        const alerts = await client_1.prisma.alert.findMany({ where: { runId: req.params.id }, orderBy: { t: "asc" } });
        res.json(alerts);
    });
    router.post("/:id/report", async (req, res) => {
        const buffer = (0, runManager_1.getFrameBuffer)(req.params.id);
        const latest = buffer[buffer.length - 1];
        if (!latest) {
            res.status(404).json({ error: "no telemetry for this run yet" });
            return;
        }
        const result = await (0, client_2.generateAdvisory)(latest);
        const report = await client_1.prisma.report.create({
            data: {
                runId: req.params.id,
                kind: req.body?.kind ?? "advisory",
                contentMd: result.contentMd,
                source: result.source,
                model: result.model,
            },
        });
        res.json(report);
    });
    router.post("/:id/chat", async (req, res) => {
        const question = req.body?.question;
        if (!question) {
            res.status(400).json({ error: "question is required" });
            return;
        }
        const buffer = (0, runManager_1.getFrameBuffer)(req.params.id);
        const result = await (0, client_2.answerChat)(question, buffer);
        await client_1.prisma.chatMessage.create({ data: { runId: req.params.id, role: "user", content: question } });
        const saved = await client_1.prisma.chatMessage.create({ data: { runId: req.params.id, role: "assistant", content: result.answer } });
        res.json({ answer: result.answer, source: result.source, id: saved.id });
    });
    router.get("/:id/chat", async (req, res) => {
        const messages = await client_1.prisma.chatMessage.findMany({ where: { runId: req.params.id }, orderBy: { createdAt: "asc" } });
        res.json(messages);
    });
    /**
     * "What if we held X% power for the rest of the sortie?" — re-runs the same
     * Monte Carlo limit projection as the live advisory, with every remaining
     * mission leg capped at X%. This replaced a proportional placeholder that
     * simply added a fixed bonus per point of derate; the answer now comes from
     * this engine's own measured per-channel throttle sensitivity, so a derate
     * helps a lot on a heat-limited channel and barely at all on, say, a
     * failing alternator.
     */
    router.post("/:id/whatif", async (req, res) => {
        const buffer = (0, runManager_1.getFrameBuffer)(req.params.id);
        const latest = buffer[buffer.length - 1];
        const reliability = (0, runManager_1.getReliability)(req.params.id);
        if (!latest || !reliability) {
            res.status(404).json({ error: "no telemetry for this run yet" });
            return;
        }
        const powerPct = Math.max(20, Math.min(100, Number(req.body?.powerPct ?? 100)));
        res.json(reliability.whatIf(latest, powerPct));
    });
    return router;
}
//# sourceMappingURL=runs.js.map