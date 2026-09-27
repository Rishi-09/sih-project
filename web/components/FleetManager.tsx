"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";

interface Props {
  initialEngines: EngineSummary[];
}

type Filter = "all" | "airborne" | "degraded" | "grounded";

function tone(v: number | null): "ok" | "caution" | "critical" | "unknown" {
  if (v === null || v === undefined) return "unknown";
  if (v < 50) return "critical";
  if (v < 70) return "caution";
  return "ok";
}

function statusOf(e: EngineSummary): { label: string; cls: string } {
  if (e.latestRunStatus === "live") return { label: "AIRBORNE", cls: "is-ok" };
  if (e.latestRunStatus === "degraded") return { label: "DEGRADED", cls: "is-critical" };
  if (tone(e.ehi) === "critical") return { label: "GROUNDED", cls: "is-critical" };
  if (tone(e.ehi) === "caution") return { label: "CAUTION", cls: "is-caution" };
  return { label: "READY", cls: "is-accent" };
}

/** Eight subsystem cells per airframe are only available from a live run; the
 * register shows the health index it does have, split into eight bands, so the
 * row reads as a strip without inventing per-subsystem scores. */
function healthCells(ehi: number | null): string[] {
  if (ehi === null) return Array(8).fill("var(--surface-3)");
  const filled = Math.round((ehi / 100) * 8);
  const colour = ehi < 50 ? "rgba(240,90,110,0.55)" : ehi < 70 ? "rgba(224,168,46,0.48)" : "rgba(46,154,208,0.55)";
  return Array.from({ length: 8 }, (_, i) => (i < filled ? colour : "var(--surface-3)"));
}

export function FleetManager({ initialEngines }: Props) {
  const [engines, setEngines] = useState<EngineSummary[]>(initialEngines);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTail, setNewTail] = useState("");
  const [newModel, setNewModel] = useState("Rotax 915 iS, 4-cyl boxer, turbo, FADEC");
  const [creating, setCreating] = useState(false);
  const [engineToDelete, setEngineToDelete] = useState<{ id: string; tail: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep EHI and live-sortie tags in sync.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const data = await api.engines();
        if (!cancelled) setEngines(data);
      } catch {
        /* silent background poll fail */
      }
    };
    const interval = setInterval(pull, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const counts = useMemo(
    () => ({
      all: engines.length,
      airborne: engines.filter((e) => e.latestRunStatus === "live" || e.latestRunStatus === "degraded").length,
      degraded: engines.filter((e) => tone(e.ehi) === "caution").length,
      grounded: engines.filter((e) => tone(e.ehi) === "critical").length,
    }),
    [engines]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return engines
      .filter((e) => {
        if (filter === "airborne") return e.latestRunStatus === "live" || e.latestRunStatus === "degraded";
        if (filter === "degraded") return tone(e.ehi) === "caution";
        if (filter === "grounded") return tone(e.ehi) === "critical";
        return true;
      })
      .filter((e) => !q || e.tail.toLowerCase().includes(q) || e.model.toLowerCase().includes(q))
      .sort((a, b) => (a.ehi ?? 101) - (b.ehi ?? 101));
  }, [engines, filter, query]);

  const distribution = useMemo(() => {
    const bands = [
      { label: "<50", lo: 0, hi: 50 },
      { label: "50s", lo: 50, hi: 60 },
      { label: "60s", lo: 60, hi: 70 },
      { label: "70s", lo: 70, hi: 80 },
      { label: "80s", lo: 80, hi: 90 },
      { label: "90+", lo: 90, hi: 101 },
    ];
    return bands.map((b) => ({
      ...b,
      n: engines.filter((e) => e.ehi !== null && e.ehi >= b.lo && e.ehi < b.hi).length,
    }));
  }, [engines]);

  const maxBand = Math.max(1, ...distribution.map((d) => d.n));

  const nextTail = (list: EngineSummary[]) => {
    const nums = list
      .map((e) => {
        const m = /^UAV-(\d+)$/i.exec(e.tail.trim());
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : list.length + 1;
    return `UAV-${next < 10 ? "0" : ""}${next}`;
  };

  const handleOpenAdd = () => {
    setNewTail(nextTail(engines));
    setError(null);
    setShowAddModal(true);
  };

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await api.createEngine({
        tail: newTail.trim() || undefined,
        model: newModel.trim() || undefined,
      });
      setEngines((prev) => [...prev, created]);
      setShowAddModal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleInitiateDelete = (e: React.MouseEvent, id: string, tail: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (engines.length <= 1) {
      setError("At least one aircraft must remain in the fleet.");
      return;
    }
    setError(null);
    setEngineToDelete({ id, tail });
  };

  const handleConfirmDelete = async () => {
    if (!engineToDelete) return;
    const { id } = engineToDelete;
    setDeletingId(id);
    setError(null);
    try {
      setEngines((prev) => prev.filter((eng) => eng.id !== id));
      setEngineToDelete(null);
      await api.deleteEngine(id);
    } catch (err) {
      setError(`Failed to remove aircraft: ${(err as Error).message}`);
      try {
        setEngines(await api.engines());
      } catch {
        /* silent */
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fleet-page">
      {/* ---- toolbar ---- */}
      <div className="fleet-toolbar">
        <div className="seg">
          {(["all", "airborne", "degraded", "grounded"] as Filter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} {counts[f]}
            </button>
          ))}
        </div>

        <div className="filter-input">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label htmlFor="fleet-q" className="sr-only">
            Filter airframes
          </label>
          <input
            id="fleet-q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by tail or model"
          />
        </div>

        <span style={{ flex: 1 }} />
        <span className="card-meta">SORTED BY EHI, ASCENDING</span>
        <button type="button" className="btn-primary" onClick={handleOpenAdd}>
          Add airframe
        </button>
      </div>

      {error && (
        <div className="alert-item is-critical">
          <span className="alert-msg">{error}</span>
        </div>
      )}

      {/* ---- register ---- */}
      <div className="register">
        <div className="register-head">
          <span className="col-airframe">AIRFRAME</span>
          <span className="col-status">STATUS</span>
          <span className="col-health">ENGINE HEALTH</span>
          <span className="col-subsystems">HEALTH STRIP</span>
          <span className="col-limiter">MODEL</span>
          <span className="col-mission">SORTIE</span>
          <span className="col-hours">RUN</span>
          <span className="col-action" />
        </div>

        {visible.length === 0 && (
          <div className="empty-note" style={{ padding: 28 }}>
            {engines.length === 0
              ? "No airframes registered. The backend may be asleep — add one, or check the API."
              : "No airframes match this filter."}
          </div>
        )}

        {visible.map((e) => {
          const st = statusOf(e);
          const t = tone(e.ehi);
          const live = e.latestRunStatus === "live" || e.latestRunStatus === "degraded";
          return (
            <div key={e.id} className={`register-row ${t === "critical" ? "is-degraded" : ""}`}>
              <span className="col-airframe">
                <Link href={`/uav/${e.id}`} className="reg-tail">
                  {e.tail}
                </Link>
                <span className="reg-serial">{e.id}</span>
              </span>

              <span className="col-status">
                <span className={`chip ${st.cls}`}>
                  <span className="chip-dot" />
                  {st.label}
                </span>
              </span>

              <span className="col-health">
                <span className={`reg-ehi is-${t}`}>{e.ehi === null ? "—" : Math.round(e.ehi)}</span>
                <span className="lim-track">
                  <span
                    className="lim-fill"
                    style={{
                      width: `${e.ehi ?? 0}%`,
                      background: t === "unknown" ? "var(--ink-4)" : `var(--${t})`,
                    }}
                  />
                </span>
              </span>

              <span className="col-subsystems" aria-hidden="true">
                {healthCells(e.ehi).map((c, i) => (
                  <span key={i} className="reg-cell" style={{ background: c }} />
                ))}
              </span>

              <span className="col-limiter">
                <span className="reg-limiter">{e.model.split(",")[0]}</span>
                <span className="reg-limiter-detail">{e.model.split(",").slice(1).join(",").trim() || "—"}</span>
              </span>

              <span className="col-mission">
                <span className={`reg-p`} style={{ color: live ? "var(--ok)" : "var(--ink-3)" }}>
                  {live ? "LIVE" : "IDLE"}
                </span>
              </span>

              <span className="col-hours">
                <span className="reg-hours">{e.latestRunId ? e.latestRunId.slice(0, 10) : "—"}</span>
                <span className="reg-hours-of">{e.latestRunStatus ?? "no run"}</span>
              </span>

              <span className="col-action">
                <Link href={`/uav/${e.id}`} className="reg-open">
                  Console
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                </Link>
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: 30, height: 30, marginLeft: 6 }}
                  aria-label={`Remove ${e.tail}`}
                  disabled={deletingId === e.id}
                  onClick={(ev) => handleInitiateDelete(ev, e.id, e.tail)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {/* ---- summary ---- */}
      <div className="fleet-foot">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Fleet EHI distribution</h2>
          </div>
          <div className="dist-chart">
            {distribution.map((d) => (
              <span key={d.label} className="dist-col">
                <span
                  className="dist-bar"
                  style={{
                    height: d.n === 0 ? 3 : `${Math.max(14, (d.n / maxBand) * 100)}%`,
                    background: d.n === 0 ? "var(--rule-light)" : d.lo < 70 ? "var(--caution)" : "var(--series-1)",
                  }}
                />
                <span className="dist-label">{d.label}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Attention queue</h2>
            <span className="card-meta">BY HEALTH INDEX</span>
          </div>
          <div className="queue-grid">
            {visible.slice(0, 3).map((e, i) => (
              <div key={e.id} className={`queue-item ${i === 0 && tone(e.ehi) === "critical" ? "is-due" : ""}`}>
                <span className="queue-when">{i === 0 ? "LOWEST" : `RANK ${i + 1}`}</span>
                <span className="queue-what">{e.tail}</span>
                <span className="queue-why">
                  {e.ehi === null
                    ? "No health evaluation yet — run a sortie to score it."
                    : `Engine health index ${Math.round(e.ehi)}. Open the console for the binding limiter.`}
                </span>
              </div>
            ))}
            {visible.length === 0 && <div className="empty-note">Nothing in the queue.</div>}
          </div>
        </section>
      </div>

      {/* ---- add modal ---- */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <form className="modal-panel" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
            <h2 className="card-title">Add airframe</h2>
            <label className="eyebrow" htmlFor="new-tail">
              TAIL
            </label>
            <input
              id="new-tail"
              className="modal-input"
              value={newTail}
              onChange={(e) => setNewTail(e.target.value)}
              autoFocus
            />
            <label className="eyebrow" htmlFor="new-model">
              MODEL
            </label>
            <input
              id="new-model"
              className="modal-input"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
            />
            {error && <span className="reg-limiter is-critical">{error}</span>}
            <div className="mr-actions">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? "Adding…" : "Add airframe"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---- delete confirm ---- */}
      {engineToDelete && (
        <div className="modal-backdrop" onClick={() => setEngineToDelete(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">Remove {engineToDelete.tail}?</h2>
            <span className="reg-limiter">
              This deletes the airframe and its run history from the register. It cannot be undone.
            </span>
            <div className="mr-actions">
              <button type="button" className="btn-danger" onClick={handleConfirmDelete}>
                Remove airframe
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEngineToDelete(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
