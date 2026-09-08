"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
exports.config = {
    port: Number(process.env.PORT ?? 4000),
    corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
    groqApiKey: process.env.GROQ_API_KEY || undefined,
    groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    mlApiUrl: (process.env.ML_API_URL || process.env.HF_ML_URL)?.replace(/\/+$/, "") || undefined,
    get hfMlUrl() {
        return this.mlApiUrl;
    },
};
//# sourceMappingURL=config.js.map