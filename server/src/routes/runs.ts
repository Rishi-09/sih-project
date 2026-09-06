import { Router } from "express";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../db/client";
import { startRun, injectFault, clearFaults, stopRun, getFrameBuffer, getReliability, isActive, getStatus, setStatus } from "../twin/runManager";
import { FAULT_CLASS_BY_ID, SENSOR_FAULT_BY_ID } from "../twin/contract";
import { RunClock } from "../twin/clock";
import { StartRunRequest, FaultRequest } from "../types";
import { generateAdvisory, answerChat } from "../ai/client";

const clocks = new Map<string, RunClock>();

/** Telemetry flows over the socket; control goes over REST — see published
 * plan §B5 for why (curl-debuggable, auditable in logs, easy to reason about
 * at 2am when the fault button does nothing). */
export function createRunsRouter(io: SocketIOServer) {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const body = req.body as StartRunRequest;
      if (!body.engineId) {
        res.status(400).json({ error: "engineId is required" });
        return;
      }
      const { runId } = await startRun(body);

      const clock = new RunClock(
        runId,
        (frame) => io.to(`run:${runId}`).emit("frame", frame),
        () => {
          setStatus(runId, "degraded");
          io.to(`run:${runId}`).emit("run:status", { status: "degraded" });
        },
      );
      clocks.set(runId, clock);
      clock.start();
      io.to(`run:${runId}`).emit("run:status", { status: "live" });

      res.status(201).json({ runId });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** Faults ACCUMULATE — POST twice with different types and both stay active,
   * which is how a compound failure is reproduced from the console. An id that
   * matches neither a fault class nor a sensor fault is now a 400 rather than a
   * silently-accepted no-op. */
  router.post("/:id/fault", (req, res) => {
    try {
      const body = req.body as FaultRequest;
      if (!isActive(req.params.id)) {
        res.status(404).json({ error: "run not found or not active" });
        return;
      }
      if (!body?.type || (!FAULT_CLASS_BY_ID.has(body.type) && !SENSOR_FAULT_BY_ID.has(body.type))) {
        res.status(400).json({ error: `unknown fault type "${body?.type}"` });
        return;
      }
      injectFault(req.params.id, body);
      res.status(202).json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** Clear every active fault without ending the sortie — the counterpart to
   * accumulation. Without it the only way back to a healthy engine was to stop
   * and restart the run. */
  router.delete("/:id/faults", (req, res) => {
    try {
      if (!isActive(req.params.id)) {
        res.status(404).json({ error: "run not found or not active" });
        return;
      }
      clearFaults(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/:id/stop", async (req, res) => {
    clocks.get(req.params.id)?.stop();
    clocks.delete(req.params.id);
    await stopRun(req.params.id);
    io.to(`run:${req.params.id}`).emit("run:status", { status: "stopped" });
    res.json({ status: "stopped" });
  });

  /** Is this run actually live in THIS process? The database's own status
   * cannot answer that — see reapOrphanedRuns. The console polls this while it
   * waits for a first frame so it can tell a slow start from a dead run. */
  router.get("/:id/status", (req, res) => {
    res.json({ active: isActive(req.params.id), status: getStatus(req.params.id) ?? "stopped" });
  });

  router.get("/:id/telemetry", async (req, res) => {
    const { from, to, step } = req.query as { from?: string; to?: string; step?: string };
    const frames = await prisma.frame.findMany({
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
    const alerts = await prisma.alert.findMany({ where: { runId: req.params.id }, orderBy: { t: "asc" } });
    res.json(alerts);
  });

  router.post("/:id/report", async (req, res) => {
    const buffer = getFrameBuffer(req.params.id);
    const latest = buffer[buffer.length - 1];
    if (!latest) {
      res.status(404).json({ error: "no telemetry for this run yet" });
      return;
    }
    const result = await generateAdvisory(latest);
    const report = await prisma.report.create({
      data: {
        runId: req.params.id,
        kind: (req.body?.kind as string) ?? "advisory",
        contentMd: result.contentMd,
        source: result.source,
        model: result.model,
      },
    });
    res.json(report);
  });

  router.post("/:id/chat", async (req, res) => {
    const question = req.body?.question as string | undefined;
    if (!question) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const buffer = getFrameBuffer(req.params.id);
    const result = await answerChat(question, buffer);
    await prisma.chatMessage.create({ data: { runId: req.params.id, role: "user", content: question } });
    const saved = await prisma.chatMessage.create({ data: { runId: req.params.id, role: "assistant", content: result.answer } });
    res.json({ answer: result.answer, source: result.source, id: saved.id });
  });

  router.get("/:id/chat", async (req, res) => {
    const messages = await prisma.chatMessage.findMany({ where: { runId: req.params.id }, orderBy: { createdAt: "asc" } });
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
    const buffer = getFrameBuffer(req.params.id);
    const latest = buffer[buffer.length - 1];
    const reliability = getReliability(req.params.id);
    if (!latest || !reliability) {
      res.status(404).json({ error: "no telemetry for this run yet" });
      return;
    }
    const powerPct = Math.max(20, Math.min(100, Number(req.body?.powerPct ?? 100)));
    res.json(reliability.whatIf(latest, powerPct));
  });

  return router;
}
