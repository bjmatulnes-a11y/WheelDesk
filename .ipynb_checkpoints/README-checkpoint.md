# WheelDesk

WheelDesk is a compliance-aware decision support platform for covered calls, cash-secured puts, and wheel strategy operations.

## What this repository includes

- Product strategy and monetization docs
- Technical architecture and API design
- MVP analytics modules for options decision support
- Starter landing page and dashboard UI
- Waitlist capture flow
- Mock-data mode for rapid validation

## Prerequisites

- **Node.js 20 LTS** (includes npm, recommended)
- Node 22 also works
- Node 24 is allowed (if you hit toolchain issues, use Node 20 LTS)
- Git
- Optional: PostgreSQL 15+ for local DB-backed development

> Windows: if `npm` is not recognized, install Node.js from https://nodejs.org and restart PowerShell.

## Quick start

1. Open a terminal at the **repo root** (the folder containing `package.json`).
2. Copy environment file:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run development server:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000

## Main routes

- `/` → landing page (`src/app/page.tsx`)
- `/dashboard` → mock dashboard (`src/app/dashboard/page.tsx`)
- `/dashboard/wheel` → wheel workspace (`src/app/dashboard/wheel/page.tsx`)

## Common Windows issues

### `npm : The term 'npm' is not recognized`

Cause: Node.js/npm is not installed (or PATH not refreshed).

Fix:
1. Install Node.js 20 LTS from https://nodejs.org
2. Close and reopen PowerShell
3. Verify:
   ```powershell
   node -v
   npm -v
   ```
4. Then run from repo root:
   ```powershell
   npm install
   npm run dev
   ```


### `Configuring Next.js via 'next.config.ts' is not supported`

Cause: your installed Next.js version expects `next.config.js`/`next.config.mjs`, not TypeScript config.

Fix:
1. Pull latest repo changes (this is now fixed in-repo by using `next.config.mjs`).
2. Remove old install artifacts and reinstall:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
npm run dev
```

### `ERESOLVE unable to resolve dependency tree`

Cause: incompatible dependency versions (commonly React/Next mismatch) or stale lockfile/node_modules.

Fix (after pulling latest):

```powershell
# from repo root
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
npm run dev
```

This repo now pins a compatible set: Next `14.2.15` with React `18.2.0`.

### Running from the wrong folder

You must run commands from the repository root (where `package.json` exists), **not** from `src/app/dashboard`.

Check location:

```powershell
Get-ChildItem package.json
```

If this returns nothing, `cd` to the repo root first.

## Core principles

- Decision support, not guaranteed outcomes
- Transparent assumptions and scenario ranges
- Portfolio workflow first (plan, track, roll, review)
- Compliance-aware product language and UX

## Product docs

- `docs/architecture.md`
- `docs/product_requirements.md`
- `docs/monetization_plan.md`
- `docs/compliance_notes.md`
- `docs/api_design.md`
