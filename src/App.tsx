import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CheckResult,
  ExplainResult,
  ExposureResult,
  GitCommit,
  InventoryResult,
  StoreEntry,
} from "../shared/schema";
import { BalanceSheet, VerdictPill, formatBytes } from "./components/BalanceSheet";

type Tab = "store" | "gitdiff" | "explain" | "inventory" | "exposure";

interface ProjectChoice {
  readonly name: string;
  readonly path: string;
  readonly hasLockfile: boolean;
  readonly hasStore: boolean;
}

function dedupeBySubject(entries: readonly StoreEntry[]): StoreEntry[] {
  const bestBySubject = new Map<string, StoreEntry>();
  for (const entry of entries) {
    const subj = entry.ledger.subject;
    const prev = bestBySubject.get(subj);
    if (!prev) {
      bestBySubject.set(subj, entry);
      continue;
    }
    const prevTime = prev.decision?.as_of ?? prev.ledger.new.published_at ?? "";
    const curTime = entry.decision?.as_of ?? entry.ledger.new.published_at ?? "";
    if (
      curTime > prevTime ||
      (curTime === prevTime && entry.ledger.tool_version > prev.ledger.tool_version)
    ) {
      bestBySubject.set(subj, entry);
    }
  }
  const deduped = [...bestBySubject.values()];
  deduped.sort((a, b) => {
    const rank = (e: StoreEntry): number => {
      if (e.decision?.verdict === "stop" && !e.approval_valid) return 0;
      if (e.decision?.verdict === "stop") return 1;
      if (e.decision?.verdict === "read") return 2;
      return 3;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const at = a.decision?.as_of ?? a.ledger.new.published_at ?? "";
    const bt = b.decision?.as_of ?? b.ledger.new.published_at ?? "";
    return bt.localeCompare(at);
  });
  return deduped;
}

export function App() {
  const [tab, setTab] = useState<Tab>("store");
  const [projectDir, setProjectDir] = useState<string>("");
  const [dirDraft, setDirDraft] = useState<string>("");
  const [projects, setProjects] = useState<ProjectChoice[]>([]);

  const [storeEntries, setStoreEntries] = useState<StoreEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<"all" | "stops" | "approved" | "explained">("all");
  const [checkedStopIds, setCheckedStopIds] = useState<Set<string>>(() => new Set());
  const [batchCopied, setBatchCopied] = useState(false);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [baseRef, setBaseRef] = useState("HEAD~1");
  const [headRef, setHeadRef] = useState("HEAD");
  const [diffResult, setDiffResult] = useState<CheckResult | null>(null);
  const [selectedDiffIdx, setSelectedDiffIdx] = useState(0);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

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
      setCheckedStopIds(new Set());
      const deduped = dedupeBySubject(entries);
      setSelectedLedgerId((prev) =>
        prev && entries.some((e) => e.ledger_id === prev)
          ? prev
          : deduped[0]?.ledger_id ?? entries[0]?.ledger_id ?? null,
      );
    } catch (err: unknown) {
      setStoreError(err instanceof Error ? err.message : "Network error");
    } finally {
      setStoreLoading(false);
    }
  }, []);

  const loadGitCommits = useCallback(async (dir: string) => {
    try {
      const res = await fetch(`/api/git-commits?dir=${encodeURIComponent(dir)}`);
      const json = await res.json();
      if (res.ok && Array.isArray(json.commits)) {
        const commits: GitCommit[] = json.commits;
        setGitCommits(commits);
        if (commits.length >= 2 && commits[0] && commits[1]) {
          setHeadRef(commits[0].shortHash);
          setBaseRef(commits[1].shortHash);
        } else if (commits.length === 1 && commits[0]) {
          setHeadRef(commits[0].shortHash);
          setBaseRef("HEAD~1");
        }
      }
    } catch {
      setGitCommits([]);
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
        await Promise.all([loadStore(current), loadGitCommits(current)]);
      }
    })();
  }, [loadProjects, loadStore, loadGitCommits]);

  async function switchProject(nextDir: string) {
    const resolved = await loadProjects(nextDir);
    if (!resolved) return;
    setDiffResult(null);
    await Promise.all([loadStore(resolved), loadGitCommits(resolved)]);
    if (tab === "inventory") {
      await loadInventory(resolved);
    }
  }

  async function handleCheckGit(e: React.FormEvent) {
    e.preventDefault();
    setDiffLoading(true);
    setDiffError(null);
    try {
      const res = await fetch("/api/check-git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectDir, baseRef, headRef }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDiffError(json.error || "Git diff check failed");
        return;
      }
      setDiffResult(json.result);
      setSelectedDiffIdx(0);
      await loadStore(projectDir);
    } catch (err: unknown) {
      setDiffError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDiffLoading(false);
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

  const activeStorePool = useMemo(
    () => (showHistory ? storeEntries : dedupeBySubject(storeEntries)),
    [storeEntries, showHistory],
  );

  const filteredStore = useMemo(() => {
    return activeStorePool.filter((e) => {
      if (storeFilter === "stops") return e.decision?.verdict === "stop" && !e.approval_valid;
      if (storeFilter === "approved") return e.decision?.verdict === "stop" && e.approval_valid;
      if (storeFilter === "explained") return e.decision?.verdict === "explained";
      return true;
    });
  }, [activeStorePool, storeFilter]);

  const selectedEntry = useMemo(
    () => filteredStore.find((e) => e.ledger_id === selectedLedgerId) ?? filteredStore[0] ?? null,
    [filteredStore, selectedLedgerId],
  );

  const visibleUnapprovedStops = useMemo(
    () => filteredStore.filter((e) => e.decision?.verdict === "stop" && !e.approval_valid),
    [filteredStore],
  );

  const batchCommand = useMemo(() => {
    if (checkedStopIds.size === 0) return "";
    const ids = [...checkedStopIds].map((id) => id.slice(0, 16));
    return `carat approve ${ids.join(" ")}`;
  }, [checkedStopIds]);

  function toggleStopCheck(ledgerId: string) {
    setCheckedStopIds((prev) => {
      const next = new Set(prev);
      if (next.has(ledgerId)) next.delete(ledgerId);
      else next.add(ledgerId);
      return next;
    });
  }

  async function copyBatchCmd() {
    if (!batchCommand) return;
    try {
      await navigator.clipboard.writeText(batchCommand);
      setBatchCopied(true);
      setTimeout(() => setBatchCopied(false), 1800);
    } catch {
      // Clipboard unavailable.
    }
  }

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    const q = invSearch.trim().toLowerCase();
    return inventory.packages
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.instance_path.toLowerCase().includes(q),
      )
      .slice(0, 250);
  }, [inventory, invSearch]);

  const dedupedCount = useMemo(() => dedupeBySubject(storeEntries).length, [storeEntries]);
  const unapprovedStops = useMemo(
    () =>
      dedupeBySubject(storeEntries).filter(
        (e) => e.decision?.verdict === "stop" && !e.approval_valid,
      ).length,
    [storeEntries],
  );

  const selectedDiffItem = diffResult?.transitions[selectedDiffIdx] ?? null;

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
          Store Ledgers ({dedupedCount}
          {unapprovedStops > 0 ? ` · ${unapprovedStops} stops` : ""})
        </button>
        <button
          type="button"
          className={`tab ${tab === "gitdiff" ? "active" : ""}`}
          onClick={() => setTab("gitdiff")}
        >
          Git Diff
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
            {checkedStopIds.size > 0 && (
              <div className="batch-bar">
                <strong style={{ fontSize: 13 }}>
                  Batch approve ({checkedStopIds.size} selected):
                </strong>
                <div className="batch-cmd">{batchCommand}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void copyBatchCmd()}
                  >
                    {batchCopied ? "Copied" : "Copy batch command"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCheckedStopIds(new Set())}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
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
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {(["all", "stops", "approved", "explained"] as const).map((f) => (
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
                <div className="row" style={{ marginBottom: 10 }}>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={showHistory}
                      onChange={(e) => setShowHistory(e.target.checked)}
                    />
                    Show history ({storeEntries.length})
                  </label>
                  {visibleUnapprovedStops.length > 0 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={() =>
                        setCheckedStopIds(
                          new Set(visibleUnapprovedStops.map((e) => e.ledger_id)),
                        )
                      }
                    >
                      Select all stops ({visibleUnapprovedStops.length})
                    </button>
                  )}
                </div>
                <div className="list">
                  {filteredStore.map((entry) => {
                    const isUnapprovedStop =
                      entry.decision?.verdict === "stop" && !entry.approval_valid;
                    return (
                      <div key={entry.ledger_id} className="list-item-row">
                        {isUnapprovedStop && (
                          <label className="stop-check" title="Include in batch approve command">
                            <input
                              type="checkbox"
                              checked={checkedStopIds.has(entry.ledger_id)}
                              onChange={() => toggleStopCheck(entry.ledger_id)}
                            />
                          </label>
                        )}
                        <button
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
                      </div>
                    );
                  })}
                  {!storeLoading && filteredStore.length === 0 && (
                    <div className="muted">
                      No matching ledgers in <code>{projectDir}/.carat/ledgers</code>.
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

        {tab === "gitdiff" && (
          <div>
            <form
              className="card"
              style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}
              onSubmit={(e) => void handleCheckGit(e)}
            >
              <label className="muted" style={{ fontSize: 12 }}>
                Base:
              </label>
              <input
                className="input mono"
                style={{ width: 140 }}
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                list="git-commits-list"
                placeholder="HEAD~1"
              />
              <label className="muted" style={{ fontSize: 12 }}>
                Head:
              </label>
              <input
                className="input mono"
                style={{ width: 140 }}
                value={headRef}
                onChange={(e) => setHeadRef(e.target.value)}
                list="git-commits-list"
                placeholder="HEAD"
              />
              <datalist id="git-commits-list">
                {gitCommits.map((c) => (
                  <option key={c.hash} value={c.shortHash}>
                    {c.date.slice(0, 10)} — {c.subject}
                  </option>
                ))}
              </datalist>
              <button type="submit" className="btn btn-primary" disabled={diffLoading}>
                {diffLoading ? "Running carat check…" : "Run Carat Check"}
              </button>
              {gitCommits.length > 0 && (
                <span className="muted mono" style={{ fontSize: 12 }}>
                  {gitCommits.length} lockfile commit(s) found
                </span>
              )}
            </form>

            {diffError && <div className="error-banner">{diffError}</div>}

            {diffResult && (
              <>
                <div className="stat-grid">
                  <div className="stat">
                    <div className="stat-label">Gate Status</div>
                    <div
                      className="stat-value"
                      style={{ color: diffResult.passed ? "var(--green)" : "var(--red)" }}
                    >
                      {diffResult.passed ? "PASSED" : "STOPPED"}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Changed Packages</div>
                    <div className="stat-value">{diffResult.transitions.length}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Transition Errors</div>
                    <div className="stat-value">{diffResult.transition_errors.length}</div>
                  </div>
                </div>

                {diffResult.transitions.length === 0 ? (
                  <div className="card muted">
                    No changed packages between <code>{baseRef}</code> and <code>{headRef}</code>.
                  </div>
                ) : (
                  <div className="split">
                    <div className="card">
                      <div className="card-title">
                        Transitions ({diffResult.transitions.length})
                      </div>
                      <div className="list">
                        {diffResult.transitions.map((tr, i) => (
                          <button
                            key={tr.ledger_id ?? `${tr.ledger.name}-${i}`}
                            type="button"
                            className={`list-item ${selectedDiffIdx === i ? "selected" : ""}`}
                            onClick={() => setSelectedDiffIdx(i)}
                          >
                            <div className="row">
                              <strong className="mono">{tr.ledger.name}</strong>
                              <VerdictPill
                                decision={tr.decision}
                                approval={
                                  tr.approved_by
                                    ? {
                                        kind: "approval",
                                        schema: 2,
                                        subject: tr.ledger.subject,
                                        ledger_id: tr.decision.ledger_id,
                                        approved_facts: tr.decision.stop_facts,
                                        approver: tr.approved_by,
                                        approved_at: tr.decision.as_of,
                                      }
                                    : null
                                }
                              />
                            </div>
                            <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
                              {tr.ledger.reference?.version ?? "new"} → {tr.ledger.new.version}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      {selectedDiffItem && (
                        <BalanceSheet
                          ledgerId={
                            selectedDiffItem.ledger_id ?? selectedDiffItem.decision.ledger_id
                          }
                          ledger={selectedDiffItem.ledger}
                          decision={selectedDiffItem.decision}
                          approval={
                            selectedDiffItem.approved_by
                              ? {
                                  kind: "approval",
                                  schema: 2,
                                  subject: selectedDiffItem.ledger.subject,
                                  ledger_id: selectedDiffItem.decision.ledger_id,
                                  approved_facts: selectedDiffItem.decision.stop_facts,
                                  approver: selectedDiffItem.approved_by,
                                  approved_at: selectedDiffItem.decision.as_of,
                                }
                              : null
                          }
                          residualDiffs={selectedDiffItem.residual_diffs}
                          route={selectedDiffItem.route}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
                      style={{
                        color: inventory.missing_integrity > 0 ? "var(--red)" : "var(--green)",
                      }}
                    >
                      {inventory.missing_integrity}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">Non-Registry</div>
                    <div
                      className="stat-value"
                      style={{
                        color: inventory.non_registry > 0 ? "var(--amber)" : "var(--green)",
                      }}
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
                              <span
                                className={`pill ${h.still_present ? "pill-stop" : "pill-muted"}`}
                              >
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
