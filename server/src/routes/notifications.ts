import { Router } from "express";
import { alertsDispatcher } from "../twin/alertsDispatcher";

export const notificationsRouter = Router();

notificationsRouter.get("/config", (_req, res) => {
  res.json({
    topic: alertsDispatcher.getTopic(),
    webhookConfigured: Boolean(alertsDispatcher.getWebhook()),
    ntfySubscribeUrl: `https://ntfy.sh/${encodeURIComponent(alertsDispatcher.getTopic())}`,
  });
});

notificationsRouter.post("/config", (req, res) => {
  const { topic, webhookUrl } = req.body;
  if (topic && typeof topic === "string") {
    alertsDispatcher.setTopic(topic);
  }
  if (webhookUrl !== undefined) {
    alertsDispatcher.setWebhook(webhookUrl || undefined);
  }
  res.json({
    ok: true,
    topic: alertsDispatcher.getTopic(),
    webhookConfigured: Boolean(alertsDispatcher.getWebhook()),
    ntfySubscribeUrl: `https://ntfy.sh/${encodeURIComponent(alertsDispatcher.getTopic())}`,
  });
});

notificationsRouter.post("/test", async (req, res) => {
  const { topic } = req.body;
  try {
    const result = await alertsDispatcher.sendTest(topic);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to dispatch test notification" });
  }
});
