# Carat Lens

A local, strictly read-only visual **Dependency Balance Sheet** dashboard for [Carat](https://github.com/steph4n-gh/carat).

Built end-to-end with Carat as the sole installer (`carat add` / `carat add -D`, zero raw `npm install`) and gated by `.github/workflows/carat-pr.yml`.

![Carat Lens — Live Explain with syntax-highlighted inline residual diffs](docs/screenshot-explain.png)

## Views

### 1. Live Explain (`carat explain`)
Run any `<pkg>@<from>..<to>` registry transition on demand and inspect byte accounting, provenance anchor metadata, stop rules, and syntax-highlighted inline residual diffs without extracting untrusted tarballs to disk.

### 2. Store Ledgers (`.carat/`)
Inspect every recorded transition ledger, decision, and human approval in a repository's `.carat/` store—complete with break/flag/reach badges, filterable file-origin tables, and one-click copyable `carat approve <16-hex>` commands.

![Carat Lens — Store Ledgers balance sheet view](docs/screenshot-store.png)

### 3. Lockfile Inventory (`carat inventory`)
Audit standing lockfile health (`package-lock.json` v3): total package instances, missing SHA-512 integrity hashes, non-registry sources, and searchable package paths.

![Carat Lens — Lockfile Inventory view](docs/screenshot-inventory.png)

### 4. Exposure Search (`carat exposure`)
Trace historical admission windows for any `<name>@<version>` across Git lockfile history and the local `.carat/` store.

---

## Security Boundary
- Binds strictly to `127.0.0.1:4177`.
- Executes `carat` via `execFile` (never a shell) with strict Zod input validation on every API boundary.
- **Strictly read-only:** never runs `carat approve`, never edits `carat.toml`, and never installs packages.

## Running Locally

Prerequisites: Node 22+ (native TypeScript execution) and `carat` on your `PATH` (`cargo install carat`).

```bash
# Production build (single port: http://127.0.0.1:4177)
npm run build
npm start

# Development (API on :4177 + Vite HMR on :5177)
npm run dev:server
npm run dev

# Integration tests (node:test against real Carat CLI & local .carat store)
npm test
```

Point `carat-lens` at any project by setting `CARAT_LENS_DIR=/path/to/repo`, typing a path in the top bar, or picking a sibling repository from the auto-discovered project dropdown.
