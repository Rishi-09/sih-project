"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const config_1 = require("./config");
const gateway_1 = require("./ws/gateway");
const runs_1 = require("./routes/runs");
const runManager_1 = require("./twin/runManager");
const engines_1 = require("./routes/engines");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigin }));
app.use(express_1.default.json());
const httpServer = http_1.default.createServer(app);
const io = (0, gateway_1.createSocketGateway)(httpServer);
app.use("/api/engines", engines_1.enginesRouter);
app.use("/api/runs", (0, runs_1.createRunsRouter)(io));
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        aiConfigured: Boolean(config_1.config.groqApiKey),
        mlConfigured: Boolean(config_1.config.hfMlUrl),
    });
});
// Clear runs orphaned by the previous process before serving anything, so the
// console is never handed a runId that can never produce a frame.
(0, runManager_1.reapOrphanedRuns)()
    .then((n) => n > 0 && console.log(`cleared ${n} orphaned live run(s) from a previous process`))
    .catch((e) => console.error("orphan reap failed", e));
// Keep ML microservice alive by pinging /health every 14 minutes (prevents 15m idle spin-down on free tiers like Render)
if (config_1.config.mlApiUrl) {
    const KEEP_ALIVE_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes
    const pingMlKeepAlive = async () => {
        try {
            const pingUrl = `${config_1.config.mlApiUrl}/health`;
            const response = await fetch(pingUrl, { method: "GET" });
            if (response.ok) {
                const body = await response.json();
                console.log(`[ML keep-alive] Pinged ${pingUrl} successfully at ${new Date().toISOString()} (service: ${body?.service ?? "ok"})`);
            }
            else {
                console.warn(`[ML keep-alive] Ping to ${pingUrl} returned HTTP ${response.status}`);
            }
        }
        catch (err) {
            console.warn(`[ML keep-alive] Could not ping ${config_1.config.mlApiUrl}/health: ${err.message}`);
        }
    };
    // Immediate ping upon server boot, then recurring every 14 minutes
    pingMlKeepAlive();
    const keepAliveTimer = setInterval(pingMlKeepAlive, KEEP_ALIVE_INTERVAL_MS);
    // Ensure timer does not prevent process exit if shutting down
    if (keepAliveTimer.unref)
        keepAliveTimer.unref();
}
httpServer.listen(config_1.config.port, () => {
    console.log(`twin-server listening on :${config_1.config.port}`);
    console.log(`AI advisory mode: ${config_1.config.groqApiKey ? `live (${config_1.config.groqModel})` : "offline fallback (no GROQ_API_KEY)"}`);
    if (config_1.config.mlApiUrl) {
        console.log(`ML microservice URL: ${config_1.config.mlApiUrl} (14m keep-alive active)`);
    }
});
//# sourceMappingURL=index.js.map