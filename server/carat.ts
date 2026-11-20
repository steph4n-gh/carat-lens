import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { z } from "zod";
import {
  ApprovalRecordSchema,
  CheckResultSchema,
  DecisionSchema,
  ExplainResultSchema,
  ExposureResultSchema,
  InventoryResultSchema,
  TransitionLedgerSchema,
  type ApprovalRecord,
  type CheckResult,
  type Decision,
  type ExplainResult,
  type ExposureResult,
  type GitCommit,
  type InventoryResult,
  type StoreEntry,
} from "../shared/schema.ts";

const execFileAsync = promisify(execFile);

export type CaratCommandOutcome<T> =
  | { readonly kind: "ok"; readonly exitCode: 0 | 1; readonly data: T }
  | { readonly kind: "error"; readonly exitCode: number; readonly message: string };

const CARAT_BIN = process.env.CARAT_BIN || "carat";

interface ExecFileError {
  readonly code?: unknown;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

function isExecFileError(err: unknown): err is ExecFileError {
  return (
    typeof err === "object" &&
    err !== null &&
    ("code" in err || "stdout" in err || "stderr" in err)
  );
}

async function runCaratJson<S extends z.ZodTypeAny>(opts: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly schema: S;
}): Promise<CaratCommandOutcome<z.infer<S>>> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    const res = await execFileAsync(CARAT_BIN, [...opts.args], {
      cwd: opts.cwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err: unknown) {
    if (isExecFileError(err)) {
      exitCode = typeof err.code === "number" ? err.code : 2;
      stdout = typeof err.stdout === "string" ? err.stdout : "";
      stderr = typeof err.stderr === "string" ? err.stderr : "";
    } else {
      return {
        kind: "error",
        exitCode: 2,
        message: err instanceof Error ? err.message : "Failed to execute carat",
      };
    }
  }

  if (exitCode !== 0 && exitCode !== 1) {
    return {
      kind: "error",
      exitCode,
      message: stderr.trim() || stdout.trim() || `carat exited with code ${exitCode}`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout);
  } catch {
    return {
      kind: "error",
      exitCode: exitCode || 2,
      message: stderr.trim() || `Invalid JSON from carat: ${stdout.slice(0, 200)}`,
    };
  }

  const validated = opts.schema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      kind: "error",
      exitCode: 2,
      message: `Carat JSON schema mismatch: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }

  return {
    kind: "ok",
    exitCode: exitCode === 1 ? 1 : 0,
    data: validated.data,
  };
}

export async function resolveSafeDir(dirInput: string): Promise<string> {
  const resolved = path.resolve(dirInput);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}

export async function runExplain(opts: {
  readonly spec: string;
  readonly projectDir: string;
}): Promise<CaratCommandOutcome<ExplainResult>> {
  return runCaratJson({
    args: ["explain", opts.spec, "--json"],
    cwd: opts.projectDir,
    schema: ExplainResultSchema,
  });
}

export async function runInventory(opts: {
  readonly projectDir: string;
}): Promise<CaratCommandOutcome<InventoryResult>> {
  const lockPath = path.join(opts.projectDir, "package-lock.json");
  try {
    await fs.access(lockPath);
  } catch {
    return {
      kind: "error",
      exitCode: 2,
      message: `No package-lock.json found in ${opts.projectDir}`,
    };
  }
  return runCaratJson({
    args: ["inventory", "--lock", lockPath, "--json"],
    cwd: opts.projectDir,
    schema: InventoryResultSchema,
  });
}

export async function runExposure(opts: {
  readonly spec: string;
  readonly projectDir: string;
}): Promise<CaratCommandOutcome<ExposureResult>> {
  return runCaratJson({
    args: ["exposure", opts.spec, "--repo", opts.projectDir, "--json"],
    cwd: opts.projectDir,
    schema: ExposureResultSchema,
  });
}

export async function listLockfileCommits(projectDir: string): Promise<GitCommit[]> {
  try {
    const res = await execFileAsync(
      "git",
      ["log", "-n", "15", "--format=%H%x1f%h%x1f%aI%x1f%s", "--", "package-lock.json"],
      {
        cwd: projectDir,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
      },
    );
    const commits: GitCommit[] = [];
    for (const line of res.stdout.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\x1f");
      const hash = parts[0];
      const shortHash = parts[1];
      const date = parts[2];
      const subject = parts[3] ?? "";
      if (hash && shortHash && date) {
        commits.push({ hash, shortHash, date, subject });
      }
    }
    return commits;
  } catch {
    return [];
  }
}

async function gitShowFile(projectDir: string, ref: string, filePath: string): Promise<Buffer | null> {
  try {
    const res = await execFileAsync("git", ["show", `${ref}:${filePath}`], {
      cwd: projectDir,
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15_000,
    });
    return res.stdout;
  } catch {
    return null;
  }
}

export async function runCheckGit(opts: {
  readonly projectDir: string;
  readonly baseRef: string;
  readonly headRef: string;
}): Promise<CaratCommandOutcome<CheckResult>> {
  const [baseLock, headLock, basePkg, headPkg] = await Promise.all([
    gitShowFile(opts.projectDir, opts.baseRef, "package-lock.json"),
    gitShowFile(opts.projectDir, opts.headRef, "package-lock.json"),
    gitShowFile(opts.projectDir, opts.baseRef, "package.json"),
    gitShowFile(opts.projectDir, opts.headRef, "package.json"),
  ]);

  if (!headLock) {
    return {
      kind: "error",
      exitCode: 2,
      message: `No package-lock.json found at revision ${opts.headRef}`,
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "carat-lens-diff-"));
  try {
    const baseLockPath = path.join(tmpDir, "base-lock.json");
    const headLockPath = path.join(tmpDir, "head-lock.json");
    const emptyLock = Buffer.from(
      JSON.stringify({ name: "empty", lockfileVersion: 3, packages: { "": {} } }),
    );
    await fs.writeFile(baseLockPath, baseLock ?? emptyLock);
    await fs.writeFile(headLockPath, headLock);

    const args = ["check", "--base", baseLockPath, "--head", headLockPath, "--json"];
    if (basePkg) {
      const p = path.join(tmpDir, "base-pkg.json");
      await fs.writeFile(p, basePkg);
      args.push("--base-pkg", p);
    }
    if (headPkg) {
      const p = path.join(tmpDir, "head-pkg.json");
      await fs.writeFile(p, headPkg);
      args.push("--head-pkg", p);
    }

    return await runCaratJson({
      args,
      cwd: opts.projectDir,
      schema: CheckResultSchema,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function readJsonDir<S extends z.ZodTypeAny>(
  dir: string,
  schema: S,
): Promise<Array<{ readonly id: string; readonly value: z.infer<S> }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const results: Array<{ readonly id: string; readonly value: z.infer<S> }> = [];
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        results.push({ id: file.slice(0, -5), value: parsed.data });
      }
    } catch {
      // Skip unreadable or non-JSON entries in store dir.
    }
  }
  return results;
}

function isApprovalValidForDecision(
  approval: ApprovalRecord | null,
  decision: Decision | null,
  subject: string,
): boolean {
  if (!approval || approval.subject !== subject) {
    return false;
  }
  if (!decision) {
    return true;
  }
  const approvedSet = new Set(approval.approved_facts);
  return decision.stop_facts.every((fact) => approvedSet.has(fact));
}

export async function readStoreEntries(projectDir: string): Promise<StoreEntry[]> {
  const storeRoot = path.join(projectDir, ".carat");
  const [ledgers, decisions, approvals] = await Promise.all([
    readJsonDir(path.join(storeRoot, "ledgers"), TransitionLedgerSchema),
    readJsonDir(path.join(storeRoot, "decisions"), DecisionSchema),
    readJsonDir(path.join(storeRoot, "approvals"), ApprovalRecordSchema),
  ]);

  const decisionByLedger = new Map<string, Decision>();
  for (const { value } of decisions) {
    const existing = decisionByLedger.get(value.ledger_id);
    if (!existing || value.as_of > existing.as_of) {
      decisionByLedger.set(value.ledger_id, value);
    }
  }

  // Match carat-core semantics: approvals are keyed by transition `subject`.
  const approvalBySubject = new Map<string, ApprovalRecord>();
  for (const { value } of approvals) {
    const existing = approvalBySubject.get(value.subject);
    if (!existing || value.approved_at > existing.approved_at) {
      approvalBySubject.set(value.subject, value);
    }
  }

  const entries: StoreEntry[] = ledgers.map(({ id, value }) => {
    const decision = decisionByLedger.get(id) ?? null;
    const approval = approvalBySubject.get(value.subject) ?? null;
    const approval_valid = isApprovalValidForDecision(approval, decision, value.subject);
    return {
      ledger_id: id,
      ledger: value,
      decision,
      approval: approval_valid ? approval : null,
      approval_valid,
    };
  });

  entries.sort((a, b) => {
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

  return entries;
}

export interface DiscoveredProject {
  readonly name: string;
  readonly path: string;
  readonly hasLockfile: boolean;
  readonly hasStore: boolean;
}

export async function discoverNearbyProjects(baseDir: string): Promise<DiscoveredProject[]> {
  const parent = path.dirname(baseDir);
  let dirents;
  try {
    dirents = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: DiscoveredProject[] = [];
  for (const d of dirents) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const full = path.join(parent, d.name);
    const [hasLockfile, hasStore] = await Promise.all([
      fs.access(path.join(full, "package-lock.json")).then(() => true, () => false),
      fs.access(path.join(full, ".carat")).then(() => true, () => false),
    ]);
    if (hasLockfile || hasStore) {
      found.push({ name: d.name, path: full, hasLockfile, hasStore });
    }
  }
  found.sort((a, b) => Number(b.hasStore) - Number(a.hasStore) || a.name.localeCompare(b.name));
  return found.slice(0, 40);
}
