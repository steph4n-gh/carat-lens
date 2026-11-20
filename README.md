# Carat Lens

A local, strictly read-only visual **Dependency Balance Sheet** dashboard for [Carat](https://github.com/steph4n-gh/carat).

## What It Does
- **Store Ledgers (`.carat/`):** Inspects recorded transition ledgers, decisions, and approvals across any local project, with a byte-accounting stacked bar, stop reasons, breaks/flags/reach pills, searchable file-origin table, and one-click copyable `carat approve <16-hex>` commands.
- **Live Explain:** Run `carat explain <pkg>@<from>..<to> --json` from the UI and inspect syntax-highlighted inline residual diffs.
- **Lockfile Inventory:** Scan `package-lock.json` via `carat inventory` for total instances, missing SHA-512 integrity, and non-registry sources.
- **Exposure Search:** Trace Git lockfile history and `.carat/` store exposure windows via `carat exposure`.
- **Nearby Project Switcher:** Discovers sibling repositories with `.carat/` stores or `package-lock.json` files.

## Security Boundary
- Binds strictly to `127.0.0.1:4177`.
- Executes `carat` via `execFile` (never a shell) with strict Zod input validation.
- **Strictly read-only:** never runs `carat approve`, never edits `carat.toml`, and never installs packages.

## Running Locally
```bash
npm run dev:server   # API server on http://127.0.0.1:4177 (Node native TypeScript)
npm run dev          # Vite dev UI on http://127.0.0.1:5177
```
Or build and serve the single-port production bundle:
```bash
npm run build
npm start            # http://127.0.0.1:4177
```
