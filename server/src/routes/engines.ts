import { stopClock } from "./runs";
import { stopRun } from "../twin/runManager";
import { Router } from "express";
import { prisma } from "../db/client";
import { getLatestFrame } from "../twin/runManager";

export const enginesRouter = Router();

const DEFAULT_MODEL = "Rotax 915 iS, 4-cyl boxer, turbo, FADEC";

enginesRouter.get("/", async (_req, res) => {
  try {
    let engines = await prisma.engine.findMany({
      include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
      orderBy: { tail: "asc" },
    });

    // If database is empty, seed 1 default aircraft simulator
    if (engines.length === 0) {
      const initial = await prisma.engine.create({
        data: { tail: "UAV-01", model: DEFAULT_MODEL },
        include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
      });
      engines = [initial];
    }

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
  } catch (err) {
    console.error("Failed to fetch engines:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

enginesRouter.post("/", async (req, res) => {
  try {
    let { tail, model } = req.body as { tail?: string; model?: string };

    if (!model) {
      model = DEFAULT_MODEL;
    }

    if (!tail) {
      // Find existing UAV-XX numbers and generate the next sequential one
      const existing = await prisma.engine.findMany({ select: { tail: true } });
      const uavNumbers = existing
        .map((e) => {
          const match = /^UAV-(\d+)$/i.exec(e.tail.trim());
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((n) => n > 0);

      const nextNum = uavNumbers.length > 0 ? Math.max(...uavNumbers) + 1 : existing.length + 1;
      tail = `UAV-${nextNum < 10 ? "0" : ""}${nextNum}`;
    }

    const engine = await prisma.engine.create({
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
  } catch (err) {
    console.error("Failed to create engine:", err);
    res.status(400).json({ error: (err as Error).message });
  }
});

enginesRouter.delete("/:id", async (req, res) => {
  try {
    const engineId = req.params.id;
    const runs = await prisma.run.findMany({ where: { engineId }, select: { id: true } });
    const runIds = runs.map((r) => r.id);

    // 1. Halt all in-memory run clocks and socket emitters
    for (const runId of runIds) {
      stopClock(runId);
      try {
        await stopRun(runId);
      } catch {
        /* already stopped */
      }
    }

    // 2. Cascade delete dependent records atomically
    if (runIds.length > 0) {
      await prisma.$transaction([
        prisma.frame.deleteMany({ where: { runId: { in: runIds } } }),
        prisma.alert.deleteMany({ where: { runId: { in: runIds } } }),
        prisma.report.deleteMany({ where: { runId: { in: runIds } } }),
        prisma.chatMessage.deleteMany({ where: { runId: { in: runIds } } }),
        prisma.run.deleteMany({ where: { engineId } }),
        prisma.engine.delete({ where: { id: engineId } }),
      ]);
    } else {
      await prisma.engine.delete({ where: { id: engineId } });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete engine:", err);
    res.status(400).json({ error: (err as Error).message });
  }
});
