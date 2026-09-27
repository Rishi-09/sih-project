"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAdvisory = generateAdvisory;
exports.answerChat = answerChat;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const config_1 = require("../config");
const prompts_1 = require("./prompts");
const kb_1 = require("./kb");
// Absent GROQ_API_KEY is a supported, first-class state here — every AI route
// degrades to the knowledge-base fallback rather than erroring. See
// server/.env.example and published plan §A7. Groq's chat completions API is
// OpenAI-compatible: messages are {role, content}, system prompt goes in the
// messages array (no separate top-level `system` field).
const client = config_1.config.groqApiKey ? new groq_sdk_1.default({ apiKey: config_1.config.groqApiKey }) : null;
async function generateAdvisory(frame) {
    const kb = (0, kb_1.getKbEntry)(frame.diagnosis.label, kbContext(frame));
    if (!client)
        return { contentMd: kb.fallbackAdvisory, source: "offline" };
    const evidence = topResiduals(frame, 5);
    const userPrompt = [
        `Current diagnosis: ${frame.diagnosis.label} (confidence ${frame.diagnosis.confidence}).`,
        frame.diagnosis.cylinder ? `Affected cylinder: ${frame.diagnosis.cylinder}.` : "",
        `Health index: ${frame.health.ehi}/100. Subsystem scores: ${JSON.stringify(frame.health.subsystems)}.`,
        `Top deviating channels (z-score): ${evidence.map(([c, z]) => `${c}=${z}σ`).join(", ")}.`,
        `Known-fault reference: ${kb.description}`,
        twinEvidence(frame),
        `Mission state: P(success)=${frame.mission.pSuccess}, recommendation=${frame.mission.recommendation}.`,
        `Time remaining: mission remaining=${fmtDuration(frame.mission.missionRemainingSec)}, safe endurance=${fmtDuration(frame.mission.safeEnduranceSec)}, time to redline at current power=${fmtDuration(frame.prognosis.rulSec)}.`,
        "Write the advisory now, following the required structure.",
    ]
        .filter(Boolean)
        .join("\n");
    try {
        const response = await client.chat.completions.create({
            model: config_1.config.groqModel,
            // Deliberately short — this is a structured, per-alert advisory read
            // standing at the aircraft, not a long-form report.
            max_tokens: 1024,
            messages: [
                { role: "system", content: prompts_1.ADVISORY_SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
        });
        const text = response.choices[0]?.message?.content ?? "";
        if (!text)
            throw new Error("empty completion from advisory call");
        return { contentMd: text, source: "llm", model: config_1.config.groqModel };
    }
    catch (err) {
        // Deliberate catch-all, not a missed error-handling nuance: the plan calls
        // for identical behavior on every failure mode (bad key, rate limit,
        // timeout, network) — fall back to the offline advisory so the AI panel
        // never shows an error on stage. See published plan §A7.
        console.error("advisory LLM call failed, serving offline fallback:", err);
        return { contentMd: kb.fallbackAdvisory, source: "offline" };
    }
}
async function answerChat(question, recentFrames) {
    const latest = recentFrames[recentFrames.length - 1];
    if (!latest)
        return { answer: "No telemetry is available for this run yet.", source: "offline" };
    if (!client) {
        return {
            answer: `Offline mode (no GROQ_API_KEY configured): current diagnosis is "${latest.diagnosis.label}" at ${Math.round(latest.diagnosis.confidence * 100)}% confidence, health index ${latest.health.ehi}/100. Set the key in server/.env for a grounded natural-language answer.`,
            source: "offline",
        };
    }
    try {
        const response = await client.chat.completions.create({
            model: config_1.config.groqModel,
            max_tokens: 512,
            messages: [
                { role: "system", content: prompts_1.CHAT_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: `Telemetry context (last ${recentFrames.length}s of this run):\n${summarizeFrames(recentFrames)}\n\nOperator question: ${question}`,
                },
            ],
        });
        const text = response.choices[0]?.message?.content ?? "";
        return { answer: text || "No answer generated.", source: "llm" };
    }
    catch (err) {
        console.error("chat LLM call failed:", err);
        return { answer: "The advisory service is temporarily unavailable — try again shortly.", source: "offline" };
    }
}
function fmtDuration(s) {
    if (s === null)
        return "n/a";
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
}
function topResiduals(frame, n) {
    return Object.entries(frame.residualZ)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, n);
}
function summarizeFrames(frames) {
    const latest = frames[frames.length - 1];
    const evidence = topResiduals(latest, 6);
    return [
        `t=${latest.t}s, phase=${latest.phase}`,
        `diagnosis=${latest.diagnosis.label} (confidence ${latest.diagnosis.confidence}), cylinder=${latest.diagnosis.cylinder ?? "n/a"}`,
        `health: ehi=${latest.health.ehi}, subsystems=${JSON.stringify(latest.health.subsystems)}`,
        `top residuals: ${evidence.map(([c, z]) => `${c}=${z}σ`).join(", ")}`,
        `sensor fault: ${latest.diagnosis.sensorFault.channel ?? "none"}`,
        twinEvidence(latest),
        `mission: pSuccess=${latest.mission.pSuccess}, recommendation=${latest.mission.recommendation}, reason="${latest.mission.reason}"`,
        `time remaining: mission remaining=${fmtDuration(latest.mission.missionRemainingSec)}, safe endurance=${fmtDuration(latest.mission.safeEnduranceSec)}, time to redline at current power=${fmtDuration(latest.prognosis.rulSec)}`,
        `open alerts: ${latest.alerts.map((a) => a.code).join(", ") || "none"}`,
    ].join("\n");
}
function kbContext(frame) {
    return {
        cylinder: frame.diagnosis.cylinder,
        channel: frame.diagnosis.sensorFault.channel,
        mode: frame.diagnosis.sensorFault.mode,
    };
}
/** The physics twin's own evidence, so the advisory explains the twin's reasoning rather than guessing. */
function twinEvidence(frame) {
    const t = frame.twin;
    if (!t)
        return "Physics twin: no assessment available yet.";
    const worst = [...t.factors]
        .sort((a, b) => b.deficit - a.deficit)
        .slice(0, 3)
        .map((f) => `${f.label} ${f.value.toFixed(3)} (${Math.round(100 * f.deficit)}% of the way to failure)`);
    const sensors = t.sensorFaults.map((f) => `${f.channel} ${f.mode} (${f.evidence})`);
    const causes = t.causes.map((c) => `${c.label} ${Math.round(100 * c.score)}% - first check: ${c.check}`);
    const ttl = t.limitingChannel ? `${t.limitingChannel} reaches redline in ${Math.round(t.timeToLimit[t.limitingChannel])} s at current power` : "no thermal redline reachable at current power";
    return [
        `Physics twin attribution: ${t.attribution}.`,
        `Worst health factors: ${worst.join("; ")}.`,
        `Distrusted sensors: ${sensors.join("; ") || "none"}.`,
        `Ranked causes: ${causes.join(" | ") || "none"}.`,
        `Thermal: ${ttl}.`,
    ].join("\n");
}
//# sourceMappingURL=client.js.map