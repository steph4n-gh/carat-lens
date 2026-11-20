import { useMemo, useState } from "react";
import type {
  ApprovalRecord,
  Decision,
  OriginClass,
  ResidualDiff,
  TransitionLedger,
} from "../../shared/schema";

const ORIGIN_META: Record<OriginClass, { label: string; color: string }> = {
  carried: { label: "Carried", color: "#38bdf8" },
  source: { label: "Git Source", color: "#34d399" },
  source_elsewhere: { label: "Source (Moved)", color: "#2dd4bf" },
  source_normalized: { label: "Source (Norm)", color: "#818cf8" },
  rebuilt: { label: "Rebuilt", color: "#a78bfa" },
  unexplained: { label: "Unexplained", color: "#f87171" },
};

const ORIGIN_ORDER: readonly OriginClass[] = [
  "carried",
  "source",
  "source_elsewhere",
  "source_normalized",
  "rebuilt",
  "unexplained",
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function VerdictPill({
  decision,
  approval,
}: {
  decision: Decision | null;
  approval: ApprovalRecord | null;
}) {
  if (!decision) {
    return <span className="pill pill-muted">ledger only</span>;
  }
  if (decision.verdict === "stop" && approval) {
    return <span className="pill pill-approved">approved stop</span>;
  }
  if (decision.verdict === "stop") {
    return <span className="pill pill-stop">stop</span>;
  }
  if (decision.verdict === "read") {
    return <span className="pill pill-read">read</span>;
  }
  return <span className="pill pill-explained">explained</span>;
}

function UnifiedDiffView({ diff }: { diff: ResidualDiff }) {
  const lines = diff.diff.split("\n");
  return (
    <div className="diff-block">
      <div className="diff-header">
        <span>{diff.path}</span>
        <span className="muted">
          {formatBytes(diff.bytes)} · {diff.total_lines} lines
          {diff.truncated ? " (truncated)" : ""}
        </span>
      </div>
      <pre className="diff-pre">
        {lines.map((line, i) => {
          const cls = line.startsWith("@@")
            ? "diff-hunk"
            : line.startsWith("+")
              ? "diff-add"
              : line.startsWith("-")
                ? "diff-del"
                : "diff-ctx";
          return (
            <span key={i} className={cls}>
              {line || " "}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

export function BalanceSheet({
  ledgerId,
  ledger,
  decision,
  approval,
  residualDiffs = [],
  route = [],
}: {
  ledgerId: string;
  ledger: TransitionLedger;
  decision: Decision | null;
  approval: ApprovalRecord | null;
  residualDiffs?: readonly ResidualDiff[];
  route?: readonly { readonly from: string; readonly to: string; readonly kind: string }[];
}) {
  const [copied, setCopied] = useState(false);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [fileSearch, setFileSearch] = useState("");

  const totalBytes = useMemo(
    () =>
      ORIGIN_ORDER.reduce((sum, key) => sum + (ledger.totals[key]?.bytes ?? 0), 0),
    [ledger.totals],
  );

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return ledger.files
      .filter((f) => classFilter === "all" || f.class === classFilter)
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .slice(0, 200);
  }, [ledger.files, classFilter, fileSearch]);

  const shortId = ledgerId.slice(0, 16);
  const approveCmd = `carat approve ${shortId}`;

  async function copyApprove() {
    try {
      await navigator.clipboard.writeText(approveCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in non-secure contexts.
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {ledger.name}{" "}
            <span className="mono muted" style={{ fontSize: 15 }}>
              {ledger.reference ? ledger.reference.version : "new"} → {ledger.new.version}
            </span>
          </h2>
          <div className="mono muted" style={{ fontSize: 12, marginTop: 2 }}>
            ledger {shortId}… · subject {ledger.subject.slice(0, 16)}… · carat {ledger.tool_version}
          </div>
          {route.length > 0 && (
            <div className="mono muted" style={{ fontSize: 12, marginTop: 3 }}>
              route: root → {route.map((r) => r.to).join(" → ")}
            </div>
          )}
        </div>
        <VerdictPill decision={decision} approval={approval} />
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Total Bytes</div>
          <div className="stat-value">{formatBytes(totalBytes)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Unexplained Code</div>
          <div
            className="stat-value"
            style={{ color: ledger.unexplained_code_bytes > 0 ? "var(--red)" : "var(--green)" }}
          >
            {formatBytes(ledger.unexplained_code_bytes)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Source Anchor</div>
          <div className="stat-value" style={{ fontSize: 14 }}>
            {ledger.anchor.found ? ledger.anchor.method ?? "found" : "missing"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Release Age</div>
          <div className="stat-value" style={{ fontSize: 14 }}>
            {decision?.age_band ?? "—"}
            {decision?.published_age_hours != null ? ` (${decision.published_age_hours}h)` : ""}
          </div>
        </div>
      </div>

      <div className="card-title" style={{ marginBottom: 4 }}>
        Byte Accounting
      </div>
      <div className="bar">
        {ORIGIN_ORDER.map((cls) => {
          const bytes = ledger.totals[cls]?.bytes ?? 0;
          if (!bytes || !totalBytes) return null;
          const pct = Math.max(0.5, (bytes / totalBytes) * 100);
          return (
            <div
              key={cls}
              className="bar-seg"
              style={{ width: `${pct}%`, background: ORIGIN_META[cls].color }}
              title={`${ORIGIN_META[cls].label}: ${formatBytes(bytes)}`}
            />
          );
        })}
      </div>
      <div className="legend">
        {ORIGIN_ORDER.map((cls) => {
          const tot = ledger.totals[cls];
          if (!tot || tot.files === 0) return null;
          return (
            <span key={cls}>
              <span className="legend-dot" style={{ background: ORIGIN_META[cls].color }} />
              {ORIGIN_META[cls].label}: {tot.files} files ({formatBytes(tot.bytes)})
            </span>
          );
        })}
      </div>

      {decision && decision.verdict === "stop" && (
        <div className="approve-box">
          <div className="row">
            <strong>
              Stop rules: {decision.stop_rules.join(", ") || "none"}
            </strong>
            {approval && (
              <span className="mono" style={{ color: "var(--purple)", fontSize: 12 }}>
                Approved by {approval.approver} at {approval.approved_at}
              </span>
            )}
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {decision.stop_reasons.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
          {!approval && (
            <div className="approve-cmd">
              <span>{approveCmd}</span>
              <button type="button" className="btn" onClick={copyApprove}>
                {copied ? "Copied" : "Copy human approval command"}
              </button>
            </div>
          )}
        </div>
      )}

      {(ledger.breaks.length > 0 ||
        ledger.flags.length > 0 ||
        ledger.new_reach.length > 0 ||
        ledger.lock_alarms.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0" }}>
          {ledger.breaks.map((b) => (
            <span key={`b-${b}`} className="pill pill-stop">
              break:{b}
            </span>
          ))}
          {ledger.flags.map((f) => (
            <span key={`f-${f}`} className="pill pill-read">
              flag:{f}
            </span>
          ))}
          {ledger.new_reach.map((r) => (
            <span key={`r-${r}`} className="pill pill-stop">
              reach:{r}
            </span>
          ))}
          {ledger.lock_alarms.map((a) => (
            <span key={`a-${a}`} className="pill pill-stop">
              lock:{a}
            </span>
          ))}
        </div>
      )}

      {ledger.anchor.repository_url && (
        <div className="muted mono" style={{ fontSize: 12, marginTop: 8 }}>
          repo: {ledger.anchor.repository_url}
          {ledger.anchor.commit ? ` @ ${ledger.anchor.commit.slice(0, 12)}` : ""}
          {ledger.anchor.workflow_path ? ` · workflow: ${ledger.anchor.workflow_path}` : ""}
        </div>
      )}

      {residualDiffs.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="card-title">Inline Residual Diffs ({residualDiffs.length})</div>
          {residualDiffs.map((d) => (
            <UnifiedDiffView key={d.path} diff={d} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>
            Files ({ledger.files.length})
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              className="select"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value="all">All classes</option>
              {ORIGIN_ORDER.map((c) => (
                <option key={c} value={c}>
                  {ORIGIN_META[c].label}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Filter path..."
              value={fileSearch}
              onChange={(e) => setFileSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Class</th>
                <th>Role</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((f) => (
                <tr key={f.path}>
                  <td className="mono">{f.path}</td>
                  <td>
                    <span
                      className="legend-dot"
                      style={{ background: ORIGIN_META[f.class].color }}
                    />
                    {ORIGIN_META[f.class].label}
                  </td>
                  <td className="mono muted">{f.role}</td>
                  <td className="mono">{formatBytes(f.bytes)}</td>
                </tr>
              ))}
              {filteredFiles.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No matching files.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
