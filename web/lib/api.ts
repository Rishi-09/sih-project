export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export const api = {
  engines: () => request<import("./types").EngineSummary[]>("/api/engines"),
  createEngine: (data?: { tail?: string; model?: string }) =>
    request<import("./types").EngineSummary>("/api/engines", {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  deleteEngine: (id: string) => request<{ ok: boolean }>(`/api/engines/${id}`, { method: "DELETE" }),
  startRun: (engineId: string, scenario: string, seed?: number) =>
    request<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ engineId, scenario, seed }) }),
  stopRun: (runId: string) => request<{ status: string }>(`/api/runs/${runId}/stop`, { method: "POST" }),
  injectFault: (runId: string, type: string, severity: number, onsetDelay = 0, cylinder?: number) =>
    request<{ ok: boolean }>(`/api/runs/${runId}/fault`, {
      method: "POST",
      body: JSON.stringify({ type, severity, onsetDelay, cylinder }),
    }),
  clearFaults: (runId: string) => request<{ ok: boolean }>(`/api/runs/${runId}/faults`, { method: "DELETE" }),
  runStatus: (runId: string) => request<{ active: boolean; status: string }>(`/api/runs/${runId}/status`),
  report: (runId: string, kind: "advisory" | "debrief" = "advisory") =>
    request<{ contentMd: string; source: string; model?: string }>(`/api/runs/${runId}/report`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
  chat: (runId: string, question: string) =>
    request<{ answer: string; source: string }>(`/api/runs/${runId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  whatif: (runId: string, powerPct: number) =>
    request<import("./types").WhatIfResult>(`/api/runs/${runId}/whatif`, {
      method: "POST",
      body: JSON.stringify({ powerPct }),
    }),
  getNotificationsConfig: () =>
    request<{ topic: string; webhookConfigured: boolean; ntfySubscribeUrl: string }>("/api/notifications/config"),
  updateNotificationsConfig: (data: { topic?: string; webhookUrl?: string }) =>
    request<{ ok: boolean; topic: string; webhookConfigured: boolean; ntfySubscribeUrl: string }>(
      "/api/notifications/config",
      { method: "POST", body: JSON.stringify(data) }
    ),
  testNotification: (topic?: string) =>
    request<{ success: boolean; topic: string; details: any }>("/api/notifications/test", {
      method: "POST",
      body: JSON.stringify({ topic }),
    }),
};

