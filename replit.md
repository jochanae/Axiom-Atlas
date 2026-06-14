# Axiom-Atlas — Strategic Thinking Partner

## Product Identity

**Axiom** is the product. **Atlas** is the intelligence inside it. Nexus is retired as a user-facing name — internal file names (`nexus.ts`, `nexus.tsx`) stay as-is.

Live URL: `https://axiomsystem.app`
Repo: `jochanae/Axiom-Atlas` (private)

---

## Deployment Architecture (Current)

| Layer | Technology | Notes |
|---|---|---|
| **Backend** | `artifacts/api-server/` | Deployed to **Google Cloud Run** via `cloudbuild.yaml` + Docker |
| **Database** | **Supabase** PostgreSQL | `DATABASE_URL` points to Supabase |
| **Frontend** | **Separate repository** | Not in this Replit — deployed independently |

**This Replit is the backend development environment.** `artifacts/atlas/` here is a drifted reference copy — do not treat it as the live frontend. All meaningful work happens in `artifacts/api-server/` and `lib/`.

**HARD RULE — DO NOT TOUCH THE FRONTEND:**
- `artifacts/atlas/` is a **drifted reference copy**. It does NOT reflect the live frontend at `axiomsystem.app`.
- The live frontend is maintained separately in `jochanae/atlas-idk` (Cursor/Lovable).
- **Never** modify frontend code in this repo unless explicitly asked.
- **Never** place mockups on the Canvas that pretend to show the live app UI — they will not match.
- When backend changes affect the frontend contract, produce **copy-pasteable output files** for Jochanae to apply manually via Cursor.

**Cloud Run deployment:** Changes are pushed to GitHub → Cloud Build triggers → builds Docker image → deploys to `axiom-atlas` service in `us-east1`. Backend changes require a Cloud Build trigger to go live.

When changes touch the API contract (new routes, new response fields, new DB columns), produce copy-pasteable output files for Jochanae to apply to the frontend repo manually via Cursor.

When DB schema changes are made (`pnpm --filter @workspace/db run push`), also produce a `supabase-migration.sql` file for Jochanae to run in the Supabase SQL editor.

---

## Who This Is For

Jochanae — founder of Into Innovations. Builds production SaaS entirely from her phone using Cursor Agent on mobile. Four live products: CoinsBloom, Compani, PresentQ, IntoIQ. Axiom-Atlas is her fifth.

### How To Work With Her
- She builds from her phone. Always. Every prompt must assume mobile.
- She reviews screenshots before moving on.
- She builds by understanding, not just executing. Answer the "why."
- She has a strong visual eye. Trust her when something looks wrong.
- When things spiral, stop. Simplify or defer.
- "Let's move on" means done or deferred. Don't revisit unless she brings it back.

---

## Architecture

### Stack
- **Backend:** Express 5 (`artifacts/api-server/`) — deployed to Google Cloud Run, served at `/api`
- **Database:** Neon PostgreSQL via Drizzle ORM (`lib/db/`)
- **Frontend:** Separate repository (not in this Replit) — React + Vite, deployed independently
- **AI:** Anthropic Claude `claude-sonnet-4-6` + Google Gemini `gemini-2.5-pro`
- **Monorepo:** pnpm workspaces

### Two Separate Chat Experiences

**1. Home Chat (Global / Atlas layer)**
- Lives permanently on the home page (`/home`) — does NOT navigate away
- Backend: `POST /api/nexus/chat`
- Focus chip: "All Projects" (default) or zoom into one project
- Mode chip: Strategic / Audit / Deep Dive
- Model picker: Claude (Nuance & Strategy) / Gemini (Long Context & Speed) — both fully wired
- Briefing: auto-generated portfolio intelligence on page load (`/api/nexus/briefing`)
- Briefing shortcut on "Where were we" card in below-fold section
- This is the wide-lens strategic layer — cross-portfolio visibility

**2. Workspace Chat (Project-specific / deep lens)**
- Lives at `/project/:id` — two-pane layout (chat left, Decision Ledger right)
- Backend: `POST /api/chat`
- Scope: one project, one linked GitHub repo
- Auto-indexes linked repo on workspace open (file tree + key files + analyze scan)
- Decision Catch Engine, FILE_EDIT protocol, GitHub write-back
- StackBlitz tab embeds the linked repo for live preview/edit

---

## Navigation Structure (Mobile)

Bottom nav: **HOME | PROJECTS | [A] | LEDGER | YOU**

Center A button → navigates to most recent project workspace

**Side drawer (folder icon):**
- ATLAS — Global View · All Projects (top card)
- PROJECTS section + project list
- NAVIGATE: Dashboard, Master Map, Parking Lot, Think Freely
- TOOLS: Workshop, Project Compass

---

## Key Pages

```
artifacts/atlas/src/pages/
  home.tsx          — Home chat, briefing animation, focus/mode/model chips
  workspace.tsx     — Two-pane: left chat + right Decision Ledger canvas + StackBlitz tab
  projects.tsx      — Project list with archive/active sections
  ledger.tsx        — Full ledger; filter pills (ALL/STRUCTURE/AESTHETIC/LOGIC/GENERAL)
  parking-lot.tsx   — Parked ideas per project
  master-map.tsx    — Master Map / AxiomFlow canvas
  dashboard.tsx     — Dashboard
  think-freely.tsx  — Think Freely mode
  workshop.tsx      — Workshop
  project-compass.tsx — Project Compass
  nexus.tsx         — Redirects to /home (legacy)
  login.tsx         — Auth with Google OAuth, email/password, Apple
  vault.tsx         — Secrets Vault
  help.tsx          — Help & FAQ (updated — no Nexus branding)
```

## Key Components

```
artifacts/atlas/src/components/
  ProjectsDrawer.tsx    — Left slide-in drawer: Atlas card, projects, nav, tools
  UserMenuDropdown.tsx  — Avatar dropdown
  BelowFoldDashboard.tsx — Below-fold section on home (includes briefing shortcut)
  AxiomFlow.tsx         — Flow canvas / Master Map
  TheForge.tsx          — Prompt Forge — strategic extraction engine, solid system prompt
  AccountHubPanel.tsx   — In-app account management (password change wired)
  CockpitBar.tsx        — Mobile bottom navigation
  ReadinessRing.tsx     — Project readiness indicator
  SystemMap.tsx         — System map component
```

## Key Backend Routes

```
artifacts/api-server/src/routes/
  nexus.ts          — Home chat (/api/nexus/chat, model-aware) + briefing + activity
  chat.ts           — Workspace AI chat with Decision Catch Engine + FILE_EDIT + IMAGE_GEN
  github.ts         — GitHub read/write/analyze/auto-link pipeline
  google-auth.ts    — Google OAuth (registered, wired end-to-end)
  projects.ts       — CRUD + summary stats + archive/restore
  sessions.ts       — Session management + message history
  entries.ts        — Decision Ledger entries
  auth.ts           — Auth + Resend password reset + in-app password change
  forge.ts          — Strategic extraction engine (solid prompt, produces structured nodes)
  vault.ts          — Secrets Vault
  thoughts.ts       — Thoughts/parking lot
  stripe.ts         — Stripe webhook + subscription sync
  errorlog.ts       — Error ingestion from frontend
  terminal.ts       — Terminal command execution with sandbox
  image.ts          — Image generation (Gemini Imagen 3 + DALL-E 3 fallback)
  devserver.ts      — Dev server streaming logs
  codegen.ts        — Code generation utilities
  shell.ts          — Shell execution pipeline
```

---

## Session Memory System (Workspace)

Three-layer persistent memory:

1. **Project Memory (DB)** — `memory` column on projects table. AI writes facts using `PROJECT_MEMORY:` protocol. Injected into system prompt.
2. **User Profile (localStorage)** — name, stack, projects. Sent as `userProfile` with every chat request.
3. **Repo Scan (localStorage)** — `atlas-scan-{projectId}`. Auto-populated on workspace open. Sent as `projectMap` with every chat request.

---

## Auto-Indexing (Workspace)

When a workspace opens with a linked GitHub repo:
1. File tree + up to 5 key files are fetched and set as `fileContext` (immediate)
2. `/api/github/analyze` runs in background → caches structured map (routes, pages, components, tables, stack, summary) in `localStorage` as `atlas-scan-{id}` — skips if cache < 24h old
3. Server-side also auto-fetches file tree on every chat request
4. Server auto-selects and reads relevant files when build intent is detected

Result: Atlas knows the full codebase from message one — no FILES tab required.

---

## Decision Catch Engine

When user says something contradicting a committed decision, AI returns `DECISION_CATCH:{...}` JSON. Frontend renders a catch card:
1. Lead sentence explaining the tension
2. "Proceed anyway" → reason textarea
3. "Confirm" → logs deviation to ledger
4. "Adjust" (gold) → clears catch, refocuses input

---

## FILE_EDIT Protocol (GitHub Write-Back)

AI returns `FILE_EDIT_START / FILE_EDIT_CONTENT / FILE_EDIT_END` blocks. Frontend shows diff modal → user reviews → pushes to GitHub or creates PR. Multiple files per response supported.

---

## Design System

### Themes
- **Obsidian** (default/dark): Deep black-brown volcanic identity
- **Parchment** (light): Warm cream / cognac

### Identity Tokens
```css
--atlas-bg:          #0C0A09
--atlas-surface:     #1C1917
--atlas-fg:          #E7E5E4
--atlas-muted:       #78716C
--atlas-ember:       #92400E   /* Decision Catch, send button */
--atlas-gold:        #C9A24C   /* Accent — Ledger, labels, borders */
--atlas-border:      #252220
```

---

## What's Working (Verified in Code)

- Home chat with Claude and Gemini — both wired, model switching real
- Briefing — AI portfolio summary on load with cinematic reveal animation
- Focus chip (All Projects / specific project)
- Mode chip (Strategic / Audit / Deep Dive) — wired to system prompt
- Briefing shortcut on "Where were we" card — expands inline
- Password reset via Resend email
- In-app password change — wired in AccountHubPanel + backend
- Copy button on chat bubbles — home page
- Clear conversation — with confirmation step
- Session persistence — authenticated users skip landing
- Google OAuth — route registered and wired (needs live end-to-end test)
- Project archive/restore — active/archived sections in project list
- Workspace: Decision Ledger, catch engine, FILE_EDIT, GitHub read/write
- Auto-indexing on workspace open
- StackBlitz tab in workspace — embeds linked repo (public free; private needs StackBlitz login)
- Forge — strategic extraction engine with structured node output
- Stripe webhook auto-configures on server start; free plan capped at 1 project
- `/deep` research in workspace
- Terminal command execution with sandbox — backend wired, frontend has CONSOLE tab
- IMAGE_GEN dual-engine (Gemini Imagen 3 + DALL-E 3) — backend wired, frontend renders in chat
- Error ingestion from frontend to backend DB
- Auto-indexing — server + localStorage cache

---

## Requirements for Key Features

- **Google OAuth** — confirmed working in production
- **FILE_EDIT / GitHub write-back** — fully built. Requires: (1) a repo linked to the workspace, and (2) a personal GitHub token entered in the Files tab. Token is saved to the project in DB and sent as `x-github-token` on every write. Server's own `GITHUB_TOKEN` only covers reads — writes always use the user's token.

---

## Deferred — Do Not Lose

1. **Forge UI surfacing** — the backend is solid; the frontend needs better entry points and result integration into the workspace flow
2. **Secrets Vault** — per-project API key management (built, needs UX polish)
3. **Focus chip Atlas acknowledgment** — Atlas should open with the focused project named when a focus is active
4. **Lens per project** — changes Atlas response style per workspace
5. **Unified activity feed** — commits, decisions, sessions in one timeline

---

## Product Decisions — Locked

- Axiom = product. Atlas = intelligence inside it.
- Home page IS the global intelligence layer — lives there, never navigates away
- Two modes: wide lens (home, all projects), deep lens (workspace, one project)
- Think Freely, Master Map, AxiomFlow, Parking Lot all stay
- Model picker: Claude + Gemini only — GPT-4o, Perplexity, DeepSeek removed

---

## Cursor Prompt Pattern (Critical)

Every Cursor Agent prompt must follow this exact structure:
1. "Run `pnpm install` first if node_modules is missing."
2. Exact file path
3. Exact change — quote specific lines to find
4. "Do not change anything else"
5. "Run typecheck, push to main."

Installing packages: `pnpm add [pkg] --filter @workspace/api-server` or `--filter @workspace/atlas`. Never root-level.

After every push: Replit Git tab → Pull (manual pull required).

---

## Environment Variables

- `DATABASE_URL` — Neon PostgreSQL (production), auto-provisioned in dev
- `ANTHROPIC_API_KEY` — Claude sonnet-4-6 (via Replit AI integration proxy)
- `GOOGLE_GEMINI_API_KEY` — Gemini 2.5 Pro (image + text generation)
- `OPENAI_API_KEY` — DALL-E 3 fallback for image generation
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `SESSION_SECRET` — Express sessions
- `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Billing
- `GITHUB_TOKEN` — Server-side GitHub fallback
- `RESEND_API_KEY` — Password reset emails
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `APP_URL` — Backend URL (e.g., `https://axiom-atlas-xxx.run.app`)
- `REPLIT_DOMAINS` — Comma-separated, auto-set by Replit
- `CLOUD_BUILD_TRIGGER` — Push to main → Cloud Run deploy
- `ATLAS_REPORTING_KEY` — Admin reporting auth
- `RAILWAY_API_TOKEN` — Server token middleware
- `LOG_LEVEL` — `info` (default), `debug` for verbose

---

## Dev Commands

```bash
pnpm --filter @workspace/api-spec run codegen   # After OpenAPI spec changes
pnpm --filter @workspace/db run push            # Push DB schema changes
pnpm --filter @workspace/atlas run typecheck    # Typecheck frontend
pnpm --filter @workspace/api-server run build   # Rebuild API server
```
