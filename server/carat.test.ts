import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createApp } from "./index.ts";

const PROJECT_DIR = path.resolve(import.meta.dirname, "..");

describe("carat-lens API", () => {
  const app = createApp();

  it("reports read-only health", async () => {
    const res = await app.request("/api/health");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.readOnly, true);
  });

  it("reads real ledgers and matches approvals by subject from local .carat store", async () => {
    const res = await app.request(`/api/store?dir=${encodeURIComponent(PROJECT_DIR)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.projectDir, PROJECT_DIR);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.length > 0, "expected at least one recorded ledger");
    const approvedCount = body.entries.filter((e: { approval_valid?: boolean }) => e.approval_valid).length;
    assert.ok(approvedCount > 0, "expected subject-matched valid approvals");
  });

  it("returns lockfile inventory for project package-lock.json", async () => {
    const res = await app.request(`/api/inventory?dir=${encodeURIComponent(PROJECT_DIR)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.inventory.total_packages > 0);
    assert.equal(body.inventory.missing_integrity, 0);
  });

  it("lists git lockfile commits for the repository", async () => {
    const res = await app.request(`/api/git-commits?dir=${encodeURIComponent(PROJECT_DIR)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.commits));
    assert.ok(body.commits.length >= 2, "expected at least 2 lockfile commits");
  });

  it("rejects flag-like or malformed git refs at /api/check-git boundary", async () => {
    for (const badRef of ["--exec=id", "HEAD;rm -rf /", "main..HEAD", "HEAD:package.json"]) {
      const res = await app.request("/api/check-git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectDir: PROJECT_DIR, baseRef: badRef, headRef: "HEAD" }),
      });
      assert.equal(res.status, 400, `expected 400 for bad ref ${badRef}`);
    }
  });

  it("rejects malformed explain specs at boundary", async () => {
    const res = await app.request("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec: "chalk; rm -rf /", projectDir: PROJECT_DIR }),
    });
    assert.equal(res.status, 400);
  });
});
