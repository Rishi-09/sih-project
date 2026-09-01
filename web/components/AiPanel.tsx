"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
}

export function AiPanel({ runId }: { runId: string | null }) {
  const [advisory, setAdvisory] = useState<{ contentMd: string; source: string } | null>(null);
  const [loadingAdvisory, setLoadingAdvisory] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  async function getAdvisory() {
    if (!runId) return;
    setLoadingAdvisory(true);
    try {
      const result = await api.report(runId, "advisory");
      setAdvisory(result);
    } catch {
      setAdvisory({ contentMd: "Advisory request failed — is the backend running?", source: "offline" });
    } finally {
      setLoadingAdvisory(false);
    }
  }

  async function ask() {
    if (!runId || !question.trim()) return;
    const q = question.trim();
    setChat((c) => [...c, { role: "user", content: q }]);
    setQuestion("");
    setAsking(true);
    try {
      const result = await api.chat(runId, q);
      setChat((c) => [...c, { role: "assistant", content: result.answer }]);
    } catch {
      setChat((c) => [...c, { role: "assistant", content: "Chat request failed — is the backend running?" }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={getAdvisory} disabled={!runId || loadingAdvisory}>
        {loadingAdvisory ? "Generating…" : "Generate maintenance advisory"}
      </button>

      {advisory && (
        <div style={{ marginTop: 14 }}>
          <div className="ai-md">{advisory.contentMd}</div>
          <span className={`ai-source ${advisory.source === "llm" ? "live" : ""}`}>{advisory.source === "llm" ? "live · groq" : "offline fallback"}</span>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Ask about this engine</h2>
      <div className="chat-log">
        {chat.length === 0 && <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>e.g. "why was cylinder 3 flagged?"</div>}
        {chat.map((m, i) => (
          <div className={`chat-msg ${m.role}`} key={i}>
            {m.content}
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask a question…"
          disabled={!runId}
        />
        <button className="btn" onClick={ask} disabled={!runId || asking}>
          {asking ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
