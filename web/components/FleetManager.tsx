"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { RemoteAlertsBar } from "@/components/RemoteAlertsBar";

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

  const handleDeleteEngine = async (e: React.MouseEvent, id: string, tail: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (engines.length <= 1) {
      alert("At least one aircraft simulator must remain in the fleet.");
      return;
    }
    if (!confirm(`Are you sure you want to remove ${tail} from the fleet?`)) return;

    setDeletingId(id);
    try {
      await api.deleteEngine(id);
      setEngines((prev) => prev.filter((eng) => eng.id !== id));
    } catch (err) {
      alert(`Failed to delete engine: ${(err as Error).message}`);
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
          <h1>Fleet Overview — Aircraft Digital Twins</h1>
          <div className="fleet-stats">
            <span>{engines.length} Aircraft Monitor{engines.length === 1 ? "" : "s"}</span>
            <span className="stats-dot">•</span>
            <span className={activeSortiesCount > 0 ? "stats-live" : ""}>
              {activeSortiesCount} Active Sortie{activeSortiesCount === 1 ? "" : "s"}
            </span>
            <span className="stats-dot">•</span>
            <span className="stats-hint">All aircraft run completely independent simulators</span>
          </div>
        </div>

        <button className="btn btn-primary add-engine-btn" onClick={handleOpenAddModal}>
          + Add Aircraft
        </button>
      </header>

      <RemoteAlertsBar />

      {engines.length === 0 ? (
        <div className="empty-state">
          <p>No aircraft found in fleet.</p>
          <button className="btn btn-primary" onClick={handleOpenAddModal}>
            Initialize First Aircraft (UAV-01)
          </button>
        </div>
      ) : (
        <div className="fleet-grid">
          {engines.map((e) => {
            const isLive = e.latestRunStatus === "live";
            const isDegraded = e.latestRunStatus === "degraded";

            return (
              <div key={e.id} className="fleet-card-wrapper">
                <Link href={`/uav/${e.id}`} className="fleet-card">
                  <div className="fleet-card-top">
                    <div className="tail-section">
                      <span className="aircraft-icon">✈</span>
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
                          title={`Delete ${e.tail}`}
                          disabled={deletingId === e.id}
                          onClick={(evt) => handleDeleteEngine(evt, e.id, e.tail)}
                        >
                          {deletingId === e.id ? "…" : "×"}
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
                    <span className="btn-link">Console →</span>
                    <Link
                      href={`/uav/${e.id}/twin3d`}
                      className="twin3d-pill"
                      onClick={(evt) => evt.stopPropagation()}
                    >
                      3D Twin ◈
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
            <div className="add-icon-circle">+</div>
            <div className="add-title">Add Aircraft</div>
            <div className="add-sub">Deploy new independent digital twin</div>
          </button>
        </div>
      )}

      {/* Add Aircraft Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Deploy Aircraft Digital Twin</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateEngine}>
              <p className="modal-description">
                Add an independent digital twin instance to monitor another aircraft in the fleet with isolated telemetry, physics simulation, and health analytics.
              </p>

              <div className="form-group">
                <label htmlFor="tail-input">Tail ID / Registration</label>
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
                  {creating ? "Deploying…" : "Deploy Aircraft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
