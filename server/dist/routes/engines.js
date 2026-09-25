"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enginesRouter = void 0;
const express_1 = require("express");
const client_1 = require("../db/client");
const runManager_1 = require("../twin/runManager");
exports.enginesRouter = (0, express_1.Router)();
const DEFAULT_MODEL = "Rotax 915 iS, 4-cyl boxer, turbo, FADEC";
exports.enginesRouter.get("/", async (_req, res) => {
    try {
        let engines = await client_1.prisma.engine.findMany({
            include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
            orderBy: { tail: "asc" },
        });
        // If database is empty, seed 1 default aircraft simulator
        if (engines.length === 0) {
            const initial = await client_1.prisma.engine.create({
                data: { tail: "UAV-01", model: DEFAULT_MODEL },
                include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
            });
            engines = [initial];
        }
        const out = engines.map((e) => {
            const latestRun = e.runs[0];
            const latestFrame = latestRun ? (0, runManager_1.getLatestFrame)(latestRun.id) : undefined;
            return {
                id: e.id,
                tail: e.tail,
                model: e.model,
                latestRunId: latestRun?.id ?? null,
                latestRunStatus: latestRun?.status ?? null,
                ehi: latestFrame?.health.ehi ?? null,
            };
        });
        res.json(out);
    }
    catch (err) {
        console.error("Failed to fetch engines:", err);
        res.status(500).json({ error: err.message });
    }
});
exports.enginesRouter.post("/", async (req, res) => {
    try {
        let { tail, model } = req.body;
        if (!model) {
            model = DEFAULT_MODEL;
        }
        if (!tail) {
            // Find existing UAV-XX numbers and generate the next sequential one
            const existing = await client_1.prisma.engine.findMany({ select: { tail: true } });
            const uavNumbers = existing
                .map((e) => {
                const match = /^UAV-(\d+)$/i.exec(e.tail.trim());
                return match ? parseInt(match[1], 10) : 0;
            })
                .filter((n) => n > 0);
            const nextNum = uavNumbers.length > 0 ? Math.max(...uavNumbers) + 1 : existing.length + 1;
            tail = `UAV-${nextNum < 10 ? "0" : ""}${nextNum}`;
        }
        const engine = await client_1.prisma.engine.create({
            data: {
                tail: tail.trim(),
                model: model.trim(),
            },
        });
        res.status(201).json({
            id: engine.id,
            tail: engine.tail,
            model: engine.model,
            latestRunId: null,
            latestRunStatus: null,
            ehi: null,
        });
    }
    catch (err) {
        console.error("Failed to create engine:", err);
        res.status(400).json({ error: err.message });
    }
});
exports.enginesRouter.delete("/:id", async (req, res) => {
    try {
        const engineId = req.params.id;
        // Delete associated frames, alerts, reports, messages and runs
        const runs = await client_1.prisma.run.findMany({ where: { engineId }, select: { id: true } });
        const runIds = runs.map((r) => r.id);
        if (runIds.length > 0) {
            await client_1.prisma.frame.deleteMany({ where: { runId: { in: runIds } } });
            await client_1.prisma.alert.deleteMany({ where: { runId: { in: runIds } } });
            await client_1.prisma.report.deleteMany({ where: { runId: { in: runIds } } });
            await client_1.prisma.chatMessage.deleteMany({ where: { runId: { in: runIds } } });
            await client_1.prisma.run.deleteMany({ where: { engineId } });
        }
        await client_1.prisma.engine.delete({ where: { id: engineId } });
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Failed to delete engine:", err);
        res.status(400).json({ error: err.message });
    }
});
//# sourceMappingURL=engines.js.map