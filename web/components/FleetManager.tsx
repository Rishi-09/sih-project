"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { IconAircraft, IconClose, IconPlus, IconTwin } from "@/components/Icons";

interface Props {
  initialEngines: EngineSummary[];
}

export function FleetManager({ initialEngines }: Props) {
  const [engines, setEngines] = useState<EngineSummary[]>(initialEngines);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTail, setNewTail] = useState("");
  const [newModel, setNewModel] = useState("Rotax 915 iS, 4-cyl boxer, turbo, FADEC");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; tail: string } | null>(null);
  const [deleteBlockedMsg, setDeleteBlockedMsg] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Poll fleet status every 3s to keep EHI & live sortie tags in sync
  useEffect(() => {
    let cancelled = false;
    const fetchEngines = async () => {
      try {
        const data = await api.engines();
        if (!cancelled) setEngines(data);
      } catch {
        // silent background poll fail
      }
    };

    const interval = setInterval(fetchEngines, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const getNextTailSuggestion = (currentEngines: EngineSummary[]) => {
    const nums = currentEngines
      .map((e) => {
        const m = /^UAV-(\d+)$/i.exec(e.tail.trim());
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : currentEngines.length + 1;
    return `UAV-${next < 10 ? "0" : ""}${next}`;
  };

  const handleOpenAddModal = () => {
    setNewTail(getNextTailSuggestion(engines));
    setError(null);
    setShowAddModal(true);
  };

  const handleCreateEngine = async (e?: React.FormEvent) => {
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

  const handleRequestDelete = (e: React.MouseEvent, id: string, tail: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (engines.length <= 1) {
      setDeleteBlockedMsg("At least one aircraft must remain in the fleet.");
      return;
    }
    setPendingDelete({ id, tail });
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setDeletingId(id);
    setDeleteError(null);
    try {
      await api.deleteEngine(id);
      setEngines((prev) => prev.filter((eng) => eng.id !== id));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const activeSortiesCount = engines.filter(
    (e) => e.latestRunStatus === "live" || e.latestRunStatus === "degraded"
  ).length;

  return (
    <div className="fleet-container">
      <header className="fleet-header">
        <div>
          <h1>Fleet</h1>
          <div className="fleet-stats">
            <span>{engines.length} aircraft</span>
            <span className="stats-dot">•</span>
            <span className={activeSortiesCount > 0 ? "stats-live" : ""}>
              {activeSortiesCount} active sortie{activeSortiesCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <button className="btn btn-primary add-engine-btn" onClick={handleOpenAddModal}>
          <IconPlus width={14} height={14} /> Add aircraft
        </button>
      </header>

      {engines.length === 0 ? (
        <div className="empty-state">
          <p>No aircraft in the fleet yet.</p>
          <button className="btn btn-primary" onClick={handleOpenAddModal}>
            <IconPlus width={14} height={14} /> Add first aircraft
          </button>
        </div>
      ) : (
        <div className="fleet-grid">
          {engines.map((e) => {
            const isLive = e.latestRunStatus === "live";
            const isDegraded = e.latestRunStatus === "degraded";

            return (
              <div key={e.id} className="fleet-card-wrapper">
                {/* The digital twin is the primary destination — the console
                    (raw telemetry/controls) is one click further in, not the
                    other way around. */}
                <Link href={`/uav/${e.id}/twin3d`} className="fleet-card">
                  <div className="fleet-card-top">
                    <div className="tail-section">
                      <IconAircraft className="aircraft-icon" />
                      <span className="tail">{e.tail}</span>
                    </div>

                    <div className="fleet-card-actions">
                      <span className={`status status-${e.latestRunStatus ?? "idle"}`}>
                        {e.latestRunStatus ?? "idle"}
                      </span>
                      {engines.length > 1 && (
                        <button
                          type="button"
                          className="btn-card-delete"
                          title={`Remove ${e.tail}`}
                          disabled={deletingId === e.id}
                          onClick={(evt) => handleRequestDelete(evt, e.id, e.tail)}
                        >
                          <IconClose width={13} height={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="model">{e.model}</div>

                  <div className="ehi-section">
                    <div className="ehi-badge">
                      <span className="ehi-label">Condition:</span>
                      <span className="ehi-value">
                        {e.ehi !== null ? `EHI ${Math.round(e.ehi)}/100` : "No active sortie"}
                      </span>
                    </div>
                    {(isLive || isDegraded) && <span className="live-pulse-dot" />}
                  </div>

                  <div className="fleet-card-footer">
                    <span className="btn-link">
                      <IconTwin width={13} height={13} /> Open digital twin
                    </span>
                    <Link
                      href={`/uav/${e.id}`}
                      className="console-pill"
                      onClick={(evt) => evt.stopPropagation()}
                    >
                      Data console
                    </Link>
                  </div>
                </Link>
              </div>
            );
          })}

          {/* Quick Add Aircraft Card */}
          <button
            type="button"
            className="fleet-card add-card"
            onClick={handleOpenAddModal}
            title="Add another aircraft to monitor independently"
          >
            <div className="add-icon-circle">
              <IconPlus width={18} height={18} />
            </div>
            <div className="add-title">Add aircraft</div>
            <div className="add-sub">Deploy a new independent digital twin</div>
          </button>
        </div>
      )}

      {/* Add Aircraft Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add aircraft</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)} aria-label="Close">
                <IconClose width={16} height={16} />
              </button>
            </div>

            <form onSubmit={handleCreateEngine}>
              <p className="modal-description">
                Runs its own telemetry and physics simulation, independent of the rest of the fleet.
              </p>

              <div className="form-group">
                <label htmlFor="tail-input">Tail ID</label>
                <input
                  id="tail-input"
                  type="text"
                  placeholder="e.g. UAV-02"
                  value={newTail}
                  onChange={(e) => setNewTail(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="model-input">Engine & Airframe Model</label>
                <input
                  id="model-input"
                  type="text"
                  placeholder="Engine configuration"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  required
                />
              </div>

              {error && <div className="modal-error">{error}</div>}

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? "Adding…" : "Add aircraft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation — replaces window.confirm, which is inconsistent
          across browsers and reads as unfinished in a monitoring console. */}
      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => !deletingId && setPendingDelete(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Remove {pendingDelete.tail}?</h2>
              <button
                className="modal-close"
                onClick={() => setPendingDelete(null)}
                disabled={!!deletingId}
                aria-label="Close"
              >
                <IconClose width={16} height={16} />
              </button>
            </div>
            <p className="modal-description">
              This permanently removes the aircraft and its digital twin history. This cannot be undone.
            </p>
            {deleteError && <div className="modal-error">{deleteError}</div>}
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setPendingDelete(null)}
                disabled={!!deletingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-action"
                onClick={handleConfirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? "Removing…" : "Remove aircraft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked-delete notice — replaces window.alert for the same reason. */}
      {deleteBlockedMsg && (
        <div className="modal-backdrop" onClick={() => setDeleteBlockedMsg(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Can&apos;t remove aircraft</h2>
              <button className="modal-close" onClick={() => setDeleteBlockedMsg(null)} aria-label="Close">
                <IconClose width={16} height={16} />
              </button>
            </div>
            <p className="modal-description">{deleteBlockedMsg}</p>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setDeleteBlockedMsg(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
