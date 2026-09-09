import express from "express";
import cors from "cors";
import http from "http";
import { config } from "./config";
import { createSocketGateway } from "./ws/gateway";
import { createRunsRouter } from "./routes/runs";
import { reapOrphanedRuns } from "./twin/runManager";
import { enginesRouter } from "./routes/engines";
import { notificationsRouter } from "./routes/notifications";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const httpServer = http.createServer(app);
const io = createSocketGateway(httpServer);

app.use("/api/engines", enginesRouter);
app.use("/api/runs", createRunsRouter(io));
app.use("/api/notifications", notificationsRouter);


app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(config.groqApiKey),
    mlConfigured: Boolean(config.hfMlUrl),
  });
});

// Clear runs orphaned by the previous process before serving anything, so the
// console is never handed a runId that can never produce a frame.
reapOrphanedRuns()
  .then((n) => n > 0 && console.log(`cleared ${n} orphaned live run(s) from a previous process`))
  .catch((e) => console.error("orphan reap failed", e));

// Keep ML microservice alive by pinging /health every 14 minutes (prevents 15m idle spin-down on free tiers like Render)
if (config.mlApiUrl) {
  const KEEP_ALIVE_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes
  const pingMlKeepAlive = async () => {
    try {
      const pingUrl = `${config.mlApiUrl}/health`;
      const response = await fetch(pingUrl, { method: "GET" });
      if (response.ok) {
        const body = await response.json();
        console.log(`[ML keep-alive] Pinged ${pingUrl} successfully at ${new Date().toISOString()} (service: ${(body as any)?.service ?? "ok"})`);
      } else {
        console.warn(`[ML keep-alive] Ping to ${pingUrl} returned HTTP ${response.status}`);
      }
    } catch (err: any) {
      console.warn(`[ML keep-alive] Could not ping ${config.mlApiUrl}/health: ${err.message}`);
    }
  };

  // Immediate ping upon server boot, then recurring every 14 minutes
  pingMlKeepAlive();
  const keepAliveTimer = setInterval(pingMlKeepAlive, KEEP_ALIVE_INTERVAL_MS);
  // Ensure timer does not prevent process exit if shutting down
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}

httpServer.listen(config.port, () => {
  console.log(`twin-server listening on :${config.port}`);
  console.log(`AI advisory mode: ${config.groqApiKey ? `live (${config.groqModel})` : "offline fallback (no GROQ_API_KEY)"}`);
  if (config.mlApiUrl) {
    console.log(`ML microservice URL: ${config.mlApiUrl} (14m keep-alive active)`);
  }
});
