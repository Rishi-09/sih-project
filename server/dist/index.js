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
    res.json({ ok: true, aiConfigured: Boolean(config_1.config.groqApiKey) });
});
// Clear runs orphaned by the previous process before serving anything, so the
// console is never handed a runId that can never produce a frame.
(0, runManager_1.reapOrphanedRuns)()
    .then((n) => n > 0 && console.log(`cleared ${n} orphaned live run(s) from a previous process`))
    .catch((e) => console.error("orphan reap failed", e));
httpServer.listen(config_1.config.port, () => {
    console.log(`twin-server listening on :${config_1.config.port}`);
    console.log(`AI advisory mode: ${config_1.config.groqApiKey ? `live (${config_1.config.groqModel})` : "offline fallback (no GROQ_API_KEY)"}`);
});
//# sourceMappingURL=index.js.map