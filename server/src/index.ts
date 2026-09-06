import express from "express";
import cors from "cors";
import http from "http";
import { config } from "./config";
import { createSocketGateway } from "./ws/gateway";
import { createRunsRouter } from "./routes/runs";
import { reapOrphanedRuns } from "./twin/runManager";
import { enginesRouter } from "./routes/engines";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = createSocketGateway(httpServer);

app.use("/api/engines", enginesRouter);
app.use("/api/runs", createRunsRouter(io));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(config.groqApiKey) });
});

// Clear runs orphaned by the previous process before serving anything, so the
// console is never handed a runId that can never produce a frame.
reapOrphanedRuns()
  .then((n) => n > 0 && console.log(`cleared ${n} orphaned live run(s) from a previous process`))
  .catch((e) => console.error("orphan reap failed", e));

httpServer.listen(config.port, () => {
  console.log(`twin-server listening on :${config.port}`);
  console.log(`AI advisory mode: ${config.groqApiKey ? `live (${config.groqModel})` : "offline fallback (no GROQ_API_KEY)"}`);
});
