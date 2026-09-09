import { config } from "../config";
import { AlertPayload, TickFrame } from "../types";

export interface PhoneNotificationOptions {
  title: string;
  message: string;
  priority?: "urgent" | "high" | "default" | "low";
  tags?: string[];
  clickUrl?: string;
}

class AlertsDispatcher {
  private activeTopic: string = config.ntfyTopic;
  private customWebhook: string | undefined = config.alertWebhookUrl;
  private lastAlertSentAt: Map<string, number> = new Map();
  private lastEmergencyAt: number = 0;

  public getTopic(): string {
    return this.activeTopic;
  }

  public setTopic(topic: string): void {
    if (topic.trim()) {
      this.activeTopic = topic.trim();
    }
  }

  public getWebhook(): string | undefined {
    return this.customWebhook;
  }

  public setWebhook(url: string | undefined): void {
    this.customWebhook = url?.trim() || undefined;
  }

  /**
   * Broadcast a notification directly to mobile phones & PC devices.
   * Uses ntfy.sh (zero config push on iOS/Android lock screen) and custom webhooks.
   */
  public async dispatchToPhone(options: PhoneNotificationOptions): Promise<{ ntfy: boolean; webhook: boolean }> {
    const { title, message, priority = "high", tags = ["airplane", "warning"], clickUrl } = options;
    let ntfyOk = false;
    let webhookOk = false;

    // 1. ntfy.sh push notification (reaches phone lock screens even when locked/asleep)
    if (this.activeTopic) {
      try {
        const url = `https://ntfy.sh/${encodeURIComponent(this.activeTopic)}`;
        const headers: Record<string, string> = {
          "Title": title,
          "Priority": priority,
          "Tags": tags.join(","),
        };
        if (clickUrl) {
          headers["Click"] = clickUrl;
        }

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: message,
        });
        ntfyOk = res.ok;
      } catch (err) {
        console.warn(`[alertsDispatcher] ntfy push failed for topic ${this.activeTopic}:`, err);
      }
    }

    // 2. Custom Webhook (Discord, Slack, Telegram, PagerDuty, etc.)
    const webhookUrl = this.customWebhook || config.alertWebhookUrl;
    if (webhookUrl) {
      try {
        const payload = {
          content: `**[${title}]**\n${message}${clickUrl ? `\n🔗 ${clickUrl}` : ""}`,
          text: `[${title}] ${message}`,
          title,
          message,
          priority,
        };
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        webhookOk = res.ok;
      } catch (err) {
        console.warn(`[alertsDispatcher] Webhook alert failed:`, err);
      }
    }

    return { ntfy: ntfyOk, webhook: webhookOk };
  }

  /**
   * Dispatch engine alerts when detected in the simulation loop.
   * Debounces to prevent spamming notifications on every tick.
   */
  public dispatchNewAlerts(runId: string, engineTail: string, alerts: AlertPayload[], frame: TickFrame): void {
    const now = Date.now();
    const criticalAlerts = alerts.filter((a) => a.severity === "critical");
    const cautionAlerts = alerts.filter((a) => a.severity === "caution");

    for (const alert of [...criticalAlerts, ...cautionAlerts]) {
      const key = `${runId}:${alert.code}`;
      const lastSent = this.lastAlertSentAt.get(key) || 0;

      // Throttle: don't alert more than once every 45s per alert code
      if (now - lastSent < 45_000) {
        continue;
      }
      this.lastAlertSentAt.set(key, now);

      const isCritical = alert.severity === "critical";
      const title = `${isCritical ? "🚨 CRITICAL ENGINE ALERT" : "⚠️ ENGINE CAUTION"} [${engineTail}]`;
      const message = `${alert.message} (Channel: ${alert.channel}, Phase: ${frame.phase}, EHI: ${Math.round(frame.health.ehi ?? 0)}%)`;
      const priority = isCritical ? "urgent" : "high";
      const tags = isCritical ? ["rotating_light", "airplane", "fire"] : ["warning", "airplane"];

      this.dispatchToPhone({
        title,
        message,
        priority,
        tags,
        clickUrl: `${config.webAppUrl}/uav/${encodeURIComponent(engineTail)}`,
      }).catch((e) => console.error("Failed to dispatch alert to phone:", e));
    }

    // Emergency mission recommendation trigger (e.g. land_immediately or return_to_base)
    if (
      (frame.mission?.recommendation === "land_immediately" || frame.mission?.recommendation === "return_to_base") &&
      now - this.lastEmergencyAt > 60_000
    ) {
      this.lastEmergencyAt = now;
      const isLandNow = frame.mission.recommendation === "land_immediately";
      const primary = frame.mission.limiters[0]?.channel ?? "critical margin reached";
      this.dispatchToPhone({
        title: `${isLandNow ? "🚨 EMERGENCY: LAND IMMEDIATELY" : "⚠️ MISSION ALERT: RETURN TO BASE"} [${engineTail}]`,
        message: `${frame.mission.reason}. Binding limiter: ${primary}. EHI: ${Math.round(frame.health.ehi ?? 0)}%.`,
        priority: isLandNow ? "urgent" : "high",
        tags: isLandNow ? ["skull", "sos", "airplane"] : ["warning", "airplane"],
        clickUrl: `${config.webAppUrl}/uav/${encodeURIComponent(engineTail)}`,
      }).catch((e) => console.error("Failed to dispatch emergency to phone:", e));
    }
  }

  /**
   * Send an immediate test notification to verify phone connectivity.
   */
  public async sendTest(targetTopic?: string): Promise<{ success: boolean; topic: string; details: any }> {
    const topic = targetTopic?.trim() || this.activeTopic;
    const testOptions: PhoneNotificationOptions = {
      title: "✅ Test Alert: Twin Remote Monitoring",
      message: "Phone support is active! Your device will receive real-time engine warnings even when locked or running other apps.",
      priority: "high",
      tags: ["white_check_mark", "airplane", "bell"],
      clickUrl: config.webAppUrl,
    };

    const previousTopic = this.activeTopic;
    if (targetTopic) this.activeTopic = targetTopic;
    const result = await this.dispatchToPhone(testOptions);
    this.activeTopic = previousTopic;

    return {
      success: result.ntfy || result.webhook,
      topic,
      details: result,
    };
  }
}

export const alertsDispatcher = new AlertsDispatcher();
