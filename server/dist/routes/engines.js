"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enginesRouter = void 0;
const express_1 = require("express");
const client_1 = require("../db/client");
const runManager_1 = require("../twin/runManager");
exports.enginesRouter = (0, express_1.Router)();
exports.enginesRouter.get("/", async (_req, res) => {
    const engines = await client_1.prisma.engine.findMany({
        include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
    });
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
});
//# sourceMappingURL=engines.js.map