# Axiom-Atlas — Strategic Thinking Partner

## Product Identity

**Axiom** is the product. **Atlas** is the intelligence inside it. Nexus is retired as a user-facing name — internal file names (`nexus.ts`, `nexus.tsx`) stay as-is.

Live URL: `https://axiomsystem.app`
Repo: `jochanae/Axiom-Atlas` (private)

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
- **Frontend:** React + Vite (`artifacts/atlas/`) — served at `/`
- **Backend:** Express 5 (`artifacts/api-server/`) — served at `/api`
- **Database:** Replit PostgreSQL via Drizzle ORM (`lib/db/`)
- **AI:** Anthropic Claude `claude-sonnet-4-6` via `ANTHROPIC_API_KEY`
- **Monorepo:** pnpm workspaces

### Two Separate Chat Experiences

**1. Home Chat (Global / Nexus layer)**
- Lives permanently on the home page (`/home`) — does NOT navigate away
- Backend: `POST /api/nexus/chat`
- Focus picker: "All Projects" (default) or zoom into one project
- Model picker: Claude / GPT-4o / Gemini
- Briefing: auto-generated portfolio intelligence on page load (`/api/nexus/briefing`)
- This is the wide-lens strategic layer — cross-portfolio visibility

**2. Workspace Chat (Project-specific / deep lens)**
- Lives at `/project/:id` — two-pane layout (chat left, Decision Ledger right)
- Backend: `POST /api/chat`
- Scope: one project, one linked GitHub repo
- Auto-indexes linked repo on workspace open (file tree + key files + analyze scan)
- Decision Catch Engine, FILE_EDIT protocol, GitHub write-back

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
  home.tsx          — Home chat, briefing animation, focus/model chips
  workspace.tsx     — Two-pane: left chat + right Decision Ledger canvas
  projects.tsx      — Project list
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
```

## Key Components

```
artifacts/atlas/src/components/
  ProjectsDrawer.tsx    — Left slide-in drawer: Atlas card, projects, nav, tools
  UserMenuDropdown.tsx  — Avatar dropdown
  BelowFoldDashboard.tsx — Below-fold section on home
  AxiomFlow.tsx         — Flow canvas / Master Map
  TheForge.tsx          — Prompt Forge (needs rethink — currently underused)
  AccountHubPanel.tsx   — In-app account management
  CockpitBar.tsx        — Mobile bottom navigation
  ReadinessRing.tsx     — Project readiness indicator
  SystemMap.tsx         — System map component
```

## Key Backend Routes

```
artifacts/api-server/src/routes/
  nexus.ts      — Home chat (/api/nexus/chat) + briefing (/api/nexus/briefing)
  chat.ts       — Workspace AI chat with Decision Catch Engine + FILE_EDIT
  github.ts     — GitHub read/write/analyze/auto-link pipeline
  projects.ts   — CRUD + summary stats
  sessions.ts   — Session management + message history
  entries.ts    — Decision Ledger entries
  auth.ts       — Auth + Resend password reset
  forge.ts      — Prompt Forge (needs rethink)
  devserver.ts  — Dev server clone/preview (built, untested)
  vault.ts      — Secrets Vault
  thoughts.ts   — Thoughts/parking lot
```

---

## Session Memory System (Workspace)

Three-layer persistent memory:

1. **Project Memory (DB)** — `memory` column on projects table. AI writes facts using `PROJECT_MEMORY:` protocol. Injected into system prompt.
2. **User Profile (localStorage)** — name, stack, projects. Sent as `userProfile` with every chat request.
3. **Repo Scan (localStorage)** — `atlas-scan-{projectId}`. Auto-populated on workspace open. Sent as `projectMap` with every chat request.

---

## Auto-Indexing (Workspace — THE GAP CLOSED)

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

## What's Working

- Home page Atlas chat with message bubbles (stays on home page)
- Briefing — real AI portfolio summary on page load
- Focus chip (All Projects / specific project) + Model chip
- Password reset via Resend email
- Session persistence — authenticated users skip landing
- Workspace: Decision Ledger, catch engine, FILE_EDIT, GitHub read/write
- Auto-indexing on workspace open (no FILES tab required)
- Dev server feature (built — untested)
- `/deep` research in workspace (built — not surfaced visibly)

---

## What Needs Verification

- Briefing animation — two-beat cinematic reveal
- In-app password change (AccountHubPanel)
- Google OAuth
- FILE_EDIT / GitHub write-back with real linked repo
- Focus chip — All Projects may be cut off at top of sheet

---

## Deferred — Do Not Lose

1. **Prompt Forge (HIGH)** — describe intent in plain language, Atlas reads the file, writes exact surgical Cursor prompt. Currently Forge has a weak system prompt and is unused.
2. **Secrets Vault** — per-project API key management
3. **Archive flag** — `archived` boolean on projects to hide test/old projects
4. **Copy button** on chat bubbles (home page)
5. **Clear conversation** on home page
6. **Focus chip Atlas acknowledgment** — Atlas leads with focused project when one is selected
7. **Mode chip on home page** — Strategic / Audit / Deep Dive
8. **Lens per project** — changes Atlas response style per workspace
9. **Unified activity feed** — commits, decisions, sessions in one timeline
10. **Nexus system prompt rewrite** — still references "Nexus" and "Nexium"

---

## Product Decisions — Locked

- Axiom = product. Atlas = intelligence inside it.
- Home page IS the global intelligence layer — lives there, never navigates away
- Two modes: wide lens (home, all projects), deep lens (workspace, one project)
- Think Freely, Master Map, AxiomFlow, Parking Lot all stay
- Forge needs a full rethink — not a quick patch

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

- `DATABASE_URL` — PostgreSQL (auto-provisioned)
- `ANTHROPIC_API_KEY` — Claude sonnet-4-6
- `GOOGLE_GEMINI_API_KEY` — Gemini
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `SESSION_SECRET` — Express sessions
- `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `GITHUB_TOKEN` — Server-side GitHub fallback

---

## Dev Commands

```bash
pnpm --filter @workspace/api-spec run codegen   # After OpenAPI spec changes
pnpm --filter @workspace/db run push            # Push DB schema changes
pnpm --filter @workspace/atlas run typecheck    # Typecheck frontend
pnpm --filter @workspace/api-server run build   # Rebuild API server
```
