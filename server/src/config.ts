import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  mlApiUrl: (process.env.ML_API_URL || process.env.HF_ML_URL)?.replace(/\/+$/, "") || undefined,
  ntfyTopic: process.env.NTFY_TOPIC || "sih-twin-alerts",
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || undefined,
  webAppUrl: process.env.WEB_APP_URL || "http://localhost:3000",
  get hfMlUrl(): string | undefined {
    return this.mlApiUrl;
  },
};


