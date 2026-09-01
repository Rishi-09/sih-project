import Groq from "groq-sdk";
import { config } from "../config";
import { TickFrame } from "../types";
import { ADVISORY_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT } from "./prompts";
import { getKbEntry } from "./kb";

// Absent GROQ_API_KEY is a supported, first-class state here — every AI route
// degrades to the knowledge-base fallback rather than erroring. See
// server/.env.example and published plan §A7. Groq's chat completions API is
// OpenAI-compatible: messages are {role, content}, system prompt goes in the
// messages array (no separate top-level `system` field).
const client = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;

export interface AdvisoryResult {
  contentMd: string;
  source: "llm" | "offline";
  model?: string;
}

export async function generateAdvisory(frame: TickFrame): Promise<AdvisoryResult> {
  const kb = getKbEntry(frame.diagnosis.label);
  if (!client) return { contentMd: kb.fallbackAdvisory, source: "offline" };

  const evidence = topResiduals(frame, 5);
  const userPrompt = [
    `Current diagnosis: ${frame.diagnosis.label} (confidence ${frame.diagnosis.confidence}).`,
    frame.diagnosis.cylinder ? `Affected cylinder: ${frame.diagnosis.cylinder}.` : "",
    `Health index: ${frame.health.ehi}/100. Subsystem scores: ${JSON.stringify(frame.health.subsystems)}.`,
    `Top deviating channels (z-score): ${evidence.map(([c, z]) => `${c}=${z}σ`).join(", ")}.`,
    `Known-fault reference: ${kb.description}`,
    `Mission state: P(success)=${frame.mission.pSuccess}, recommendation=${frame.mission.recommendation}.`,
    "Write the advisory now, following the required structure.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await client.chat.completions.create({
      model: config.groqModel,
      // Deliberately short — this is a structured, per-alert advisory read
      // standing at the aircraft, not a long-form report.
      max_tokens: 1024,
      messages: [
        { role: "system", content: ADVISORY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    if (!text) throw new Error("empty completion from advisory call");
    return { contentMd: text, source: "llm", model: config.groqModel };
  } catch (err) {
    // Deliberate catch-all, not a missed error-handling nuance: the plan calls
    // for identical behavior on every failure mode (bad key, rate limit,
    // timeout, network) — fall back to the offline advisory so the AI panel
    // never shows an error on stage. See published plan §A7.
    console.error("advisory LLM call failed, serving offline fallback:", err);
    return { contentMd: kb.fallbackAdvisory, source: "offline" };
  }
}

export interface ChatResult {
  answer: string;
  source: "llm" | "offline";
}

export async function answerChat(question: string, recentFrames: TickFrame[]): Promise<ChatResult> {
  const latest = recentFrames[recentFrames.length - 1];
  if (!latest) return { answer: "No telemetry is available for this run yet.", source: "offline" };

  if (!client) {
    return {
      answer: `Offline mode (no GROQ_API_KEY configured): current diagnosis is "${latest.diagnosis.label}" at ${Math.round(
        latest.diagnosis.confidence * 100,
      )}% confidence, health index ${latest.health.ehi}/100. Set the key in server/.env for a grounded natural-language answer.`,
      source: "offline",
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: config.groqModel,
      max_tokens: 512,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Telemetry context (last ${recentFrames.length}s of this run):\n${summarizeFrames(recentFrames)}\n\nOperator question: ${question}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    return { answer: text || "No answer generated.", source: "llm" };
  } catch (err) {
    console.error("chat LLM call failed:", err);
    return { answer: "The advisory service is temporarily unavailable — try again shortly.", source: "offline" };
  }
}

function topResiduals(frame: TickFrame, n: number): [string, number][] {
  return Object.entries(frame.residualZ)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n);
}

function summarizeFrames(frames: TickFrame[]): string {
  const latest = frames[frames.length - 1];
  const evidence = topResiduals(latest, 6);
  return [
    `t=${latest.t}s, phase=${latest.phase}`,
    `diagnosis=${latest.diagnosis.label} (confidence ${latest.diagnosis.confidence}), cylinder=${latest.diagnosis.cylinder ?? "n/a"}`,
    `health: ehi=${latest.health.ehi}, subsystems=${JSON.stringify(latest.health.subsystems)}`,
    `top residuals: ${evidence.map(([c, z]) => `${c}=${z}σ`).join(", ")}`,
    `sensor fault: ${latest.diagnosis.sensorFault.channel ?? "none"}`,
    `mission: pSuccess=${latest.mission.pSuccess}, recommendation=${latest.mission.recommendation}`,
    `open alerts: ${latest.alerts.map((a) => a.code).join(", ") || "none"}`,
  ].join("\n");
}
