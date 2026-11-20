import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExplainResult,
  ExposureResult,
  InventoryResult,
  StoreEntry,
} from "../shared/schema";
import { BalanceSheet, VerdictPill, formatBytes } from "./components/BalanceSheet";

type Tab = "store" | "explain" | "inventory" | "exposure";

interface ProjectChoice {
  readonly name: string;
  readonly path: string;
  readonly hasLockfile: boolean;
  readonly hasStore: boolean;
}

export function App() {
  const [tab, setTab] = useState<Tab>("store");
  const [projectDir, setProjectDir] = useState<string>("");
  const [dirDraft, setDirDraft] = useState<string>("");
  const [projects, setProjects] = useState<ProjectChoice[]>([]);

  const [storeEntries, setStoreEntries] = useState<StoreEntry[]>([]);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<"all" | "stops" | "explained">("all");
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [explainSpec, setExplainSpec] = useState("chalk@5.4.0..5.4.1");
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const [inventory, setInventory] = useState<InventoryResult | null>(null);
  const [invSearch, setInvSearch] = useState("");
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  const [exposureSpec, setExposureSpec] = useState("zod@4.6.7");
  const [exposure, setExposure] = useState<ExposureResult | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expError, setExpError] = useState<string | null>(null);

  const loadStore = useCallback(async (dir: string) => {
    setStoreLoading(true);
    setStoreError(null);
    try {
      const res = await fetch(`/api/store?dir=${encodeURIComponent(dir)}`);
      const json = await res.json();
      if (!res.ok) {
        setStoreError(json.error || "Failed to load store");
        setStoreEntries([]);
        return;
      }
      const entries: StoreEntry[] = json.entries ?? [];
      setStoreEntries(entries);
      setSelectedLedgerId((prev) =>
        prev && entries.some((e) => e.ledger_id === prev)
          ? prev
          : entries[0]?.ledger_id ?? null,
      );
    } catch (err: unknown) {
      setStoreError(err instanceof Error ? err.message : "Network error");
    } finally {
      setStoreLoading(false);
    }
  }, []);

  const loadInventory = useCallback(async (dir: string) => {
    setInvLoading(true);
    setInvError(null);
    try {
      const res = await fetch(`/api/inventory?dir=${encodeURIComponent(dir)}`);
      const json = await res.json();
      if (!res.ok) {
        setInvError(json.error || "Failed to load inventory");
        setInventory(null);
        return;
      }
      setInventory(json.inventory);
    } catch (err: unknown) {
      setInvError(err instanceof Error ? err.message : "Network error");
    } finally {
      setInvLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async (dir?: string) => {
    const query = dir ? `?dir=${encodeURIComponent(dir)}` : "";
    const res = await fetch(`/api/projects${query}`);
    const json = await res.json();
    if (res.ok && typeof json.current === "string") {
      setProjectDir(json.current);
      setDirDraft(json.current);
      setProjects(Array.isArray(json.projects) ? json.projects : []);
      return json.current;
    }
    return null;
  }, []);

  useEffect(() => {
    void (async () => {
      const current = await loadProjects();
      if (current) {
        await loadStore(current);
      }
    })();
  }, [loadProjects, loadStore]);

  async function switchProject(nextDir: string) {
    const resolved = await loadProjects(nextDir);
    if (!resolved) return;
    await loadStore(resolved);
    if (tab === "inventory") {
      await loadInventory(resolved);
    }
  }

  async function handleExplain(e: React.FormEvent) {
    e.preventDefault();
    setExplainLoading(true);
    setExplainError(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: explainSpec, projectDir }),
      });
      const json = await res.json();
      if (!res.ok) {
        setExplainError(json.error || "Explain failed");
        return;
      }
      setExplainResult(json.result);
      await loadStore(projectDir);
    } catch (err: unknown) {
      setExplainError(err instanceof Error ? err.message : "Network error");
    } finally {
      setExplainLoading(false);
    }
  }

  async function handleExposure(e: React.FormEvent) {
    e.preventDefault();
    setExpLoading(true);
    setExpError(null);
    try {
      const res = await fetch("/api/exposure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: exposureSpec, projectDir }),
      });
      const json = await res.json();
      if (!res.ok) {
        setExpError(json.error || "Exposure search failed");
        return;
      }
      setExposure(json.result);
    } catch (err: unknown) {
      setExpError(err instanceof Error ? err.message : "Network error");
    } finally {
      setExpLoading(false);
    }
  }

  const filteredStore = useMemo(() => {
    return storeEntries.filter((e) => {
      if (storeFilter === "stops") return e.decision?.verdict === "stop";
      if (storeFilter === "explained") return e.decision?.verdict === "explained";
      return true;
    });
  }, [storeEntries, storeFilter]);

  const selectedEntry = useMemo(
    () => filteredStore.find((e) => e.ledger_id === selectedLedgerId) ?? filteredStore[0] ?? null,
    [filteredStore, selectedLedgerId],
  );

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    const q = invSearch.trim().toLowerCase();
    return inventory.packages
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.instance_path.toLowerCase().includes(q))
      .slice(0, 250);
  }, [inventory, invSearch]);

  const unapprovedStops = storeEntries.filter(
    (e) => e.decision?.verdict === "stop" && !e.approval,
  ).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">◆</div>
          <h1>Carat Lens</h1>
          <span className="badge-ro">READ-ONLY</span>
        </div>

        <div className="dir-bar">
          {projects.length > 0 && (
            <select
              className="select"
              value={projectDir}
              onChange={(e) => void switchProject(e.target.value)}
              aria-label="Nearby projects"
            >
              {!projects.some((p) => p.path === projectDir) && projectDir && (
                <option value={projectDir}>{projectDir}</option>
              )}
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                  {p.hasStore ? " [.carat]" : ""}
                  {p.hasLockfile ? " [lock]" : ""}
                </option>
              ))}
            </select>
          )}
          <input
            className="input mono"
            style={{ flex: 1, minWidth: 200 }}
            value={dirDraft}
            onChange={(e) => setDirDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void switchProject(dirDraft);
            }}
            placeholder="/path/to/repo"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void switchProject(dirDraft)}
          >
            Load
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={`tab ${tab === "store" ? "active" : ""}`}
          onClick={() => setTab("store")}
        >
          Store Ledgers ({storeEntries.length}
          {unapprovedStops > 0 ? ` · ${unapprovedStops} stops` : ""})
        </button>
        <button
          type="button"
          className={`tab ${tab === "explain" ? "active" : ""}`}
          onClick={() => setTab("explain")}
        >
          Live Explain
        </button>
        <button
          type="button"
          className={`tab ${tab === "inventory" ? "active" : ""}`}
          onClick={() => {
            setTab("inventory");
            if (projectDir) void loadInventory(projectDir);
          }}
        >
          Lockfile Inventory
        </button>
        <button
          type="button"
          className={`tab ${tab === "exposure" ? "active" : ""}`}
          onClick={() => setTab("exposure")}
        >
          Exposure Search
        </button>
      </nav>

      <main className="main">
        {tab === "store" && (
          <>
            {storeError && <div className="error-banner">{storeError}</div>}
            <div className="split">
              <div className="card">
                <div className="row" style={{ marginBottom: 10 }}>
                  <div className="card-title" style={{ margin: 0 }}>
                    Recorded Ledgers
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={storeLoading}
                    onClick={() => void loadStore(projectDir)}
                  >
                    {storeLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {(["all", "stops", "explained"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`btn ${storeFilter === f ? "btn-primary" : ""}`}
                      onClick={() => setStoreFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="list">
                  {filteredStore.map((entry) => (
                    <button
                      key={entry.ledger_id}
                      type="button"
                      className={`list-item ${selectedEntry?.ledger_id === entry.ledger_id ? "selected" : ""}`}
                      onClick={() => setSelectedLedgerId(entry.ledger_id)}
                    >
                      <div className="row">
                        <strong className="mono">{entry.ledger.name}</strong>
                        <VerdictPill decision={entry.decision} approval={entry.approval} />
                      </div>
                      <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
                        {entry.ledger.reference?.version ?? "new"} → {entry.ledger.new.version}
                        {entry.ledger.unexplained_code_bytes > 0
                          ? ` · ${formatBytes(entry.ledger.unexplained_code_bytes)} unexp`
                          : ""}
                      </div>
                    </button>
                  ))}
                  {!storeLoading && filteredStore.length === 0 && (
                    <div className="muted">
                      No ledgers found in <code>{projectDir}/.carat/ledgers</code>. Run{" "}
                      <code>carat add</code>, <code>carat check</code>, or Live Explain.
                    </div>
                  )}
                </div>
              </div>

              <div>
                {selectedEntry ? (
                  <BalanceSheet
                    ledgerId={selectedEntry.ledger_id}
                    ledger={selectedEntry.ledger}
                    decision={selectedEntry.decision}
                    approval={selectedEntry.approval}
                  />
                ) : (
                  <div className="card muted">Select a ledger to inspect its balance sheet.</div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "explain" && (
          <div>
            <form
              className="card"
              style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}
              onSubmit={(e) => void handleExplain(e)}
            >
              <input
                className="input mono"
                style={{ flex: 1, minWidth: 260 }}
                value={explainSpec}
                onChange={(e) => setExplainSpec(e.target.value)}
                placeholder="pkg@from..to (e.g. chalk@5.4.0..5.4.1)"
              />
              <button type="submit" className="btn btn-primary" disabled={explainLoading}>
                {explainLoading ? "Running carat explain…" : "Run Explain"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setExplainSpec("ms@2.1.2..2.1.3")}
              >
                Try ms@2.1.2..2.1.3
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setExplainSpec("zod@4.6.6..4.6.7")}
              >
                Try zod@4.6.6..4.6.7
              </button>
            </form>
            {explainError && <div className="error-banner">{explainError}</div>}
            {explainResult && (
              <BalanceSheet
                ledgerId={explainResult.ledger_id ?? explainResult.decision.ledger_id}
                ledger={explainResult.ledger}
                decision={explainResult.decision}
                approval={null}
                residualDiffs={explainResult.residual_diffs}
              />
            )}
          </div>
        )}

        {tab === "inventory" && (
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>
                Lockfile Inventory ({projectDir})
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  placeholder="Filter package..."
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={invLoading}
                  onClick={() => void loadInventory(projectDir)}
                >
                  {invLoading ? "Scanning…" : "Rescan"}
                </button>
              </div>
            </div>
            {invError && <div className="error-banner">{invError}</div>}
            {inventory && (
              <>
                <div className="stat-grid">
                  <div className="stat">
                    <div className="stat-label">Total Instances</div>
                    <div className="stat-value">{inventory.total_packages}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Missing SHA-512</div>
                    <div
                      className="stat-value"
                      style={{ color: inventory.missing_integrity > 0 ? "var(--red)" : "var(--green)" }}
                    >
                      {inventory.missing_integrity}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Non-Registry</div>
                    <div
                      className="stat-value"
                      style={{ color: inventory.non_registry > 0 ? "var(--amber)" : "var(--green)" }}
                    >
                      {inventory.non_registry}
                    </div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Package</th>
                        <th>Version</th>
                        <th>Source</th>
                        <th>Integrity</th>
                        <th>Instance Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInventory.map((p) => (
                        <tr key={p.instance_path}>
                          <td className="mono">{p.name}</td>
                          <td className="mono">{p.version ?? "—"}</td>
                          <td className="mono muted">{p.source_kind}</td>
                          <td className="mono">
                            {p.sha512 ? `${p.sha512.slice(0, 12)}…` : "missing"}
                          </td>
                          <td className="mono muted">{p.instance_path}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "exposure" && (
          <div className="card">
            <form
              style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}
              onSubmit={(e) => void handleExposure(e)}
            >
              <input
                className="input mono"
                style={{ flex: 1, minWidth: 240 }}
                value={exposureSpec}
                onChange={(e) => setExposureSpec(e.target.value)}
                placeholder="name@version (e.g. zod@4.6.7)"
              />
              <button type="submit" className="btn btn-primary" disabled={expLoading}>
                {expLoading ? "Searching Git & Store…" : "Trace Exposure"}
              </button>
            </form>
            {expError && <div className="error-banner">{expError}</div>}
            {exposure && (
              <>
                <div className="card-title">Git Lockfile Windows ({exposure.git_hits.length})</div>
                {exposure.git_hits.length > 0 ? (
                  <div className="table-wrap" style={{ marginBottom: 16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Package</th>
                          <th>First Commit</th>
                          <th>Last Commit</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exposure.git_hits.map((h, i) => (
                          <tr key={i}>
                            <td className="mono">
                              {h.name}@{h.version}
                            </td>
                            <td className="mono">
                              {h.first_commit.slice(0, 10)} ({h.first_date.slice(0, 10)})
                            </td>
                            <td className="mono">
                              {h.last_commit.slice(0, 10)} ({h.last_date.slice(0, 10)})
                            </td>
                            <td>
                              <span className={`pill ${h.still_present ? "pill-stop" : "pill-muted"}`}>
                                {h.still_present ? "still present" : "removed"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No Git lockfile exposure windows found.</p>
                )}

                <div className="card-title">Store Hits ({exposure.store_hits.length})</div>
                {exposure.store_hits.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Package</th>
                          <th>Ledger ID</th>
                          <th>Published</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exposure.store_hits.map((s) => (
                          <tr key={s.ledger_id}>
                            <td className="mono">
                              {s.name}@{s.version}
                            </td>
                            <td className="mono">{s.ledger_id.slice(0, 16)}…</td>
                            <td className="mono muted">{s.published_at ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No matching records in local .carat store.</p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
