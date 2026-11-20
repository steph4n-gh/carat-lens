import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import {
  CheckGitRequestSchema,
  ExplainRequestSchema,
  ExposureRequestSchema,
} from "../shared/schema.ts";
import {
  discoverNearbyProjects,
  listLockfileCommits,
  readStoreEntries,
  resolveSafeDir,
  runCheckGit,
  runExplain,
  runExposure,
  runInventory,
} from "./carat.ts";

const DEFAULT_PROJECT_DIR = path.resolve(process.env.CARAT_LENS_DIR || process.cwd());
const PORT = Number(process.env.PORT || 4177);

export function createApp() {
  const app = new Hono();

  app.get("/api/health", (c) =>
    c.json({ ok: true, defaultProjectDir: DEFAULT_PROJECT_DIR, readOnly: true }),
  );

  app.get("/api/projects", async (c) => {
    const raw = c.req.query("dir") || DEFAULT_PROJECT_DIR;
    try {
      const current = await resolveSafeDir(raw);
      const projects = await discoverNearbyProjects(current);
      return c.json({ current, projects });
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
  });

  app.get("/api/store", async (c) => {
    const raw = c.req.query("dir") || DEFAULT_PROJECT_DIR;
    try {
      const projectDir = await resolveSafeDir(raw);
      const entries = await readStoreEntries(projectDir);
      return c.json({ projectDir, entries });
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to read .carat store" },
        400,
      );
    }
  });

  app.get("/api/git-commits", async (c) => {
    const raw = c.req.query("dir") || DEFAULT_PROJECT_DIR;
    try {
      const projectDir = await resolveSafeDir(raw);
      const commits = await listLockfileCommits(projectDir);
      return c.json({ projectDir, commits });
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
  });

  app.post("/api/check-git", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = CheckGitRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        400,
      );
    }
    let projectDir: string;
    try {
      projectDir = await resolveSafeDir(parsed.data.projectDir);
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
    const outcome = await runCheckGit({
      projectDir,
      baseRef: parsed.data.baseRef,
      headRef: parsed.data.headRef,
    });
    if (outcome.kind === "error") {
      return c.json({ error: outcome.message }, 502);
    }
    return c.json({ exitCode: outcome.exitCode, result: outcome.data });
  });

  app.get("/api/inventory", async (c) => {
    const raw = c.req.query("dir") || DEFAULT_PROJECT_DIR;
    let projectDir: string;
    try {
      projectDir = await resolveSafeDir(raw);
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
    const outcome = await runInventory({ projectDir });
    if (outcome.kind === "error") {
      return c.json({ error: outcome.message }, 400);
    }
    return c.json({ projectDir, inventory: outcome.data });
  });

  app.post("/api/explain", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = ExplainRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        400,
      );
    }
    let projectDir: string;
    try {
      projectDir = await resolveSafeDir(parsed.data.projectDir || DEFAULT_PROJECT_DIR);
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
    const outcome = await runExplain({ spec: parsed.data.spec, projectDir });
    if (outcome.kind === "error") {
      return c.json({ error: outcome.message }, 502);
    }
    return c.json({ exitCode: outcome.exitCode, result: outcome.data });
  });

  app.post("/api/exposure", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = ExposureRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        400,
      );
    }
    let projectDir: string;
    try {
      projectDir = await resolveSafeDir(parsed.data.projectDir);
    } catch (err: unknown) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid directory" },
        400,
      );
    }
    const outcome = await runExposure({ spec: parsed.data.spec, projectDir });
    if (outcome.kind === "error") {
      return c.json({ error: outcome.message }, 502);
    }
    return c.json({ exitCode: outcome.exitCode, result: outcome.data });
  });

  const distDir = path.resolve(process.cwd(), "dist");
  if (fs.existsSync(distDir)) {
    app.use("/*", serveStatic({ root: "./dist" }));
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  serve({ fetch: app.fetch, hostname: "127.0.0.1", port: PORT }, (info) => {
    process.stdout.write(
      `carat-lens listening on http://127.0.0.1:${info.port} (dir=${DEFAULT_PROJECT_DIR})\n`,
    );
  });
}
