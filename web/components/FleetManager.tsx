"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { QuickMetricsStrip } from "@/components/QuickMetricsStrip";

interface Props {
  initialEngines: EngineSummary[];
}

export function FleetManager({ initialEngines }: Props) {
  const router = useRouter();
  const [engines, setEngines] = useState<EngineSummary[]>(initialEngines);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTail, setNewTail] = useState("");
  const [newModel, setNewModel] = useState("Rotax 915 iS, 4-cyl boxer, turbo, FADEC");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [engineToDelete, setEngineToDelete] = useState<{ id: string; tail: string } | null>(null);
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
        const refreshed = await api.engines();
        setEngines(refreshed);
      } catch {
        // silent fail
      }
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
        <div className="fleet-header-main">
          <Link href="/" className="drdo-fleet-logo-link" title="DRDO Fleet Command Overview">
            <img src="/drdo-logo.png" alt="DRDO Emblem" className="drdo-fleet-logo" />
          </Link>
          <div>
            <h1>UAV FLEET COMMAND</h1>
            <div className="fleet-stats">
              <span>{engines.length} Aircraft</span>
              <span className="stats-dot">•</span>
              <span className={activeSortiesCount > 0 ? "stats-live" : ""}>
                {activeSortiesCount} Active Flight{activeSortiesCount === 1 ? "" : "s"}
              </span>
              <span className="stats-dot">•</span>
              <span className="stats-hint">MIL-STD-1553B Telemetry</span>
            </div>
          </div>
        </div>

        <div className="fleet-header-actions">
          <button className="btn btn-primary add-engine-btn" onClick={handleOpenAddModal}>
            + Add Aircraft
          </button>
        </div>
      </header>

      {/* High-density real telemetry strip */}
      <QuickMetricsStrip
        totalAirframes={engines.length}
        activeSorties={activeSortiesCount}
      />

      {error && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 18px",
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          borderRadius: "8px",
          marginBottom: "20px",
          color: "#fca5a5",
          fontSize: "13px"
        }}>
          <span>⚠️ {error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: "16px" }}
          >
            ×
          </button>
        </div>
      )}

      {engines.length === 0 ? (
        <div className="empty-state">
          <p>No aircraft found in fleet.</p>
          <button className="btn btn-primary" onClick={handleOpenAddModal}>
            Add First Aircraft (UAV-01)
          </button>
        </div>
      ) : (
        <div className="fleet-grid">
          {engines.map((e) => {
            const isLive = e.latestRunStatus === "live";
            const isDegraded = e.latestRunStatus === "degraded";

            return (
              <div key={e.id} className="fleet-card-wrapper">
                <div
                  className="fleet-card"
                  style={{ cursor: "pointer" }}
                  onClick={(evt) => {
                    const target = evt.target as HTMLElement;
                    if (
                      target.closest(".btn-card-delete") ||
                      target.closest(".twin3d-pill") ||
                      target.closest(".fleet-card-actions")
                    ) {
                      return;
                    }
                    router.push(`/uav/${e.id}`);
                  }}
                >
                  <div className="fleet-card-top">
                    <div className="tail-section">
                      <span className="aircraft-icon">✈</span>
                      <span className="tail">{e.tail}</span>
                      <span className="drdo-card-badge">DRDO</span>
                    </div>

                    <div className="fleet-card-actions" onClick={(evt) => evt.stopPropagation()}>
                      <span className={`status status-${e.latestRunStatus ?? "idle"}`}>
                        {e.latestRunStatus === "live" ? "Live" : e.latestRunStatus ?? "Standby"}
                      </span>
                      {engines.length > 1 && (
                        <button
                          type="button"
                          className="btn-card-delete"
                          title={`Remove ${e.tail}`}
                          aria-label={`Remove ${e.tail}`}
                          disabled={deletingId === e.id}
                          onClick={(evt) => handleInitiateDelete(evt, e.id, e.tail)}
                        >
                          {deletingId === e.id ? "…" : "×"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="model">Rotax 915 iS Turbo</div>

                  <div className="ehi-section">
                    <div className="ehi-badge">
                      <span className="ehi-label">Health</span>
                      <span className="ehi-value">
                        {e.ehi !== null ? `${Math.round(e.ehi)}%` : "Ready"}
                      </span>
                    </div>
                    <div className="ehi-track-wrapper">
                      <div 
                        className="ehi-track-fill" 
                        style={{ 
                          width: e.ehi !== null ? `${Math.min(100, Math.max(10, e.ehi))}%` : "100%",
                          backgroundColor: e.ehi !== null 
                            ? (e.ehi < 70 ? "var(--critical)" : e.ehi < 85 ? "var(--caution)" : "var(--ok)") 
                            : "rgba(56, 189, 248, 0.4)"
                        }} 
                      />
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
                </div>
              </div>
            );
          })}

          {/* Quick Add Aircraft Card */}
          <button
            type="button"
            className="fleet-card add-card"
            onClick={handleOpenAddModal}
            title="Add aircraft"
          >
            <div className="add-icon-circle">+</div>
            <div className="add-title">Add Aircraft</div>
            <div className="add-sub">Deploy new digital twin</div>
          </button>
        </div>
      )}

      {/* Add Aircraft Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Deploy Aircraft Twin</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateEngine}>
              <p className="modal-description">
                Add an aircraft instance to monitor with live telemetry and 3D digital twin.
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

      {/* Delete Confirmation Modal */}
      {engineToDelete && (
        <div className="modal-backdrop" onClick={() => setEngineToDelete(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2>Remove {engineToDelete.tail}?</h2>
              <button className="modal-close" onClick={() => setEngineToDelete(null)}>
                ×
              </button>
            </div>
            <p className="modal-description" style={{ marginBottom: 20 }}>
              Are you sure you want to remove <strong>{engineToDelete.tail}</strong> from the fleet? All associated telemetry and sortie logs will be permanently deleted.
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setEngineToDelete(null)}
                disabled={Boolean(deletingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-action"
                onClick={handleConfirmDelete}
                disabled={Boolean(deletingId)}
              >
                {deletingId === engineToDelete.id ? "Removing…" : "Remove Aircraft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
