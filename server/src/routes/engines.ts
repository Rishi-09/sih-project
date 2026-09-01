import { Router } from "express";
import { prisma } from "../db/client";
import { getLatestFrame } from "../twin/runManager";

export const enginesRouter = Router();

enginesRouter.get("/", async (_req, res) => {
  const engines = await prisma.engine.findMany({
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  const out = engines.map((e) => {
    const latestRun = e.runs[0];
    const latestFrame = latestRun ? getLatestFrame(latestRun.id) : undefined;
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
