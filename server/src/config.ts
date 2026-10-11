import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000"),
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  groqModel: process.env.GROQ_MODEL || "gpt-oss-20b",
  mlApiUrl: process.env.ML_API_URL ||  undefined,
  get hfMlUrl(): string | undefined {
    return this.mlApiUrl;
  },
};

