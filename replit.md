# Axiom-Atlas — Backend Development Environment

## READ THIS FIRST — AGENT BEHAVIOR RULES

**DIAGNOSE AND WAIT. DO NOT ACT UNLESS EXPLICITLY TOLD TO.**

These rules exist because unsolicited agent action has caused real production damage.

- **Do not write files** unless Jochanae says "do it" or "fix it" or "push it."
- **Do not commit to GitHub** unless explicitly asked. Do not put planning documents, markdown files, or strategy documents into this repo. Code changes only.
- **Do not restart workflows** unless a code change requires it or you're told to.
- **Do not deploy to Cloud Run** without explicit instruction.
- **Do not touch the database schema** without explicit instruction. Never run `pnpm --filter @workspace/db run push` without being told to.
- **Do not modify environment variables** in Cloud Run or anywhere else without explicit instruction.
- When asked to "look at" or "check" or "find" something — look, check, find. Report back. Stop there.
- When in doubt: say what you found, ask what she wants to do next.

**If Jochanae has not told you to start — do not start.**

---

## Current Mission

The mission is not to expand Atlas.

The mission is to make the Phase 1 core loop work end-to-end:

**Chat → Project → Build → Run → Continue**

Anything outside that loop is parked unless Jochanae explicitly says otherwise.

---

## Current Production Architecture (June 2026)

| Layer | Technology | Status |
|---|---|---|
| **Backend** | `artifacts/api-server/` → Google Cloud Run | Live |
| **Database** | **Supabase** PostgreSQL | Live — DATABASE_URL on Cloud Run points here |
| **Frontend** | `jochanae/atlas-idk` → Vercel → axiomsystem.app | Live — separate repo, not here |
| **AI** | Anthropic `claude-sonnet-4-6` + Google `gemini-2.5-pro` | Live |

**The only recent infrastructure change:** DATABASE_URL in Cloud Run was changed from Neon to Supabase (June 15, 2026). The backend code was not changed. Neon still exists but is no longer the active database.

**The frontend is NOT in this repository.** `artifacts/atlas/` is a stale reference copy. The live frontend lives at `jochanae/atlas-idk`. Do not touch it here.

---

## Phase 1 Atlas — The Governing Documents

On June 16, 2026, five governance documents were written that define what Atlas is and what it is allowed to do. These documents are the authority. Every decision should be checked against them.

**ATLAS_ZERO** — Why Atlas exists, its promise, who it's for, what Phase 1 must do, and what Atlas explicitly refuses to do in Phase 1. Contains the Founder Filter: "If a new idea does not directly improve one of the three Phase 1 actions, it waits."

**ATLAS_ONE** — The first successful user experience. The test every future feature must pass.

**ATLAS_FOUNDATION** — The five minimum systems required, in order. No Phase 2 system may be prioritized until the Phase 1 core loop works end-to-end. Nothing else gets built until these five work.

**ATLAS_OWNERSHIP** — What Atlas owns (conversation, project, builder orchestration, continuity, decisions, UX) vs. what Atlas integrates with optionally (GitHub, database providers, deployment providers, third-party APIs). Contains the Atlas Test: three questions to ask before adding any technology.

**ATLAS_ARCHITECTURE** — The current production chain is Vercel frontend → Cloud Run backend → Supabase database. The architecture decision is to contain Phase 1 inside this chain, with Cloud Run as the single backend authority and Supabase as the single database.

**The line that governs everything:** Phase 1 Atlas is intentionally smaller than the vision.

---

## What Atlas Promises (Do Not Forget This)

You bring the vision. Atlas helps make it real.

Atlas is for people whose imagination outpaces their ability to execute alone. Phase 1 must do exactly three things:
1. Turn an idea into a project
2. Turn the project into something working
3. Let the user continue building from where they left off

If a proposed feature does not improve one of those three things — it waits.

---

## What This Replit Is

This is the **backend development environment** for Axiom-Atlas.

- `artifacts/api-server/` — the Express 5 backend, deployed to Cloud Run
- `lib/db/` — Drizzle ORM schema and database client

**This Replit is NOT:**
- The frontend (that is `jochanae/atlas-idk` on Vercel)
- A place to commit strategy documents or markdown files
- A place to act without asking first

---

## Database (Supabase)

The production database is Supabase PostgreSQL. The backend connects via `DATABASE_URL` in Cloud Run environment variables.

**lib/db/src/index.ts — DO NOT TOUCH THIS FILE.** It has caused a 3-day outage before.

When schema changes are needed: produce a `.sql` file for Jochanae to run in the Supabase SQL editor. Do not run `pnpm --filter @workspace/db run push` without explicit instruction.

---

## Deployment

Changes pushed to GitHub main → Cloud Build → deployed to `axiom-atlas` service in `us-east1`.

Cloud Run URL: `https://axiom-atlas-689827072865.us-east1.run.app`

Every Cursor prompt must start with: `Run pnpm install --frozen-lockfile first.`

---

## Who Jochanae Is

Founder of Into Innovations LLC. Builds production SaaS from her phone (Samsung Z Fold 6). Non-technical founder with strong product instincts.

- She understands the why before executing. Explain before acting.
- Honest assessments only. No pep talks.
- "Do not change anything else" means exactly that.
- She reviews before you proceed. Always.
- When things spiral: stop and report back.

---

## Backend Route Inventory

Do not expand route scope. Repair only what directly supports Chat → Project → Build → Run → Continue.

**Core loop — Phase 1, keep working:**
- `nexus.ts` — Home/portfolio AI chat + briefing
- `chat.ts` — Workspace AI chat + memory + decision catch + file edit
- `projects.ts` — Project CRUD
- `sessions.ts` — Session management
- `entries.ts` — Decision Ledger
- `auth.ts` / `google-auth.ts` — Authentication

**Builder/Runtime — Phase 1 gap, do not break:**
- `codegen.ts`, `generation.ts`, `preview.ts`

**Phase 2 — do not prioritize:**
- GitHub integration, blueprints, artifacts, connections, MCP, forge, deploy, terminal, stripe, everything else

---

## Known Issues (June 16, 2026)

1. Auto-navigation after project creation doesn't fire
2. Project naming uses first message text instead of Atlas-suggested name
3. Scroll position on workspace arrival lands at top instead of bottom
4. Memory extractor only fires in workspace, not home surface
5. Blueprints/artifacts are parked for Phase 2. Current errors should not be prioritized unless they block the Phase 1 core loop.

---

## Environment Variables (Cloud Run)

- `DATABASE_URL` — Supabase PostgreSQL (changed from Neon on June 15, 2026)
- `ANTHROPIC_API_KEY` — Claude claude-sonnet-4-6
- `GOOGLE_GEMINI_API_KEY` — Gemini 2.5 Pro
- `SESSION_SECRET` — Express sessions
- `TOKEN_ENCRYPTION_KEY` — GitHub token decryption (required)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `GITHUB_TOKEN` — Server-side read-only fallback
- `RESEND_API_KEY` — Password reset emails
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Billing
- `APP_URL` — Backend URL

---

## Dev Commands

```bash
pnpm install --frozen-lockfile                  # Always run this first
pnpm --filter @workspace/api-server run build   # Rebuild API server
pnpm --filter @workspace/db run push            # Push DB schema — ASK BEFORE RUNNING
```

---

## What Not To Do

- Do not touch `lib/db/src/index.ts`
- Do not commit markdown or strategy documents to this repo
- Do not run migrations without being asked
- Do not change Cloud Run environment variables without being asked
- Do not start building when asked to diagnose
- Do not treat `artifacts/atlas/` as the live frontend
- Do not build around broken foundations — fix the foundation first
