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

  it("reads real ledgers and approvals from local .carat store", async () => {
    const res = await app.request(`/api/store?dir=${encodeURIComponent(PROJECT_DIR)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.projectDir, PROJECT_DIR);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.length > 0, "expected at least one recorded ledger");
  });

  it("returns lockfile inventory for project package-lock.json", async () => {
    const res = await app.request(`/api/inventory?dir=${encodeURIComponent(PROJECT_DIR)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.inventory.total_packages > 0);
    assert.equal(body.inventory.missing_integrity, 0);
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
