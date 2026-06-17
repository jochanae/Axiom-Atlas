# PROJECT_STRUCTURE.md

Lane contract for Atlas (Lovable frontend) + Axiom-Atlas (Google Cloud Run backend + Supabase DB).
Both AI tools (Lovable agent and Cursor/Claude) read this file before editing.

## ⚠️ HARD RULE — LOVABLE IS FRONTEND ONLY

Lovable works on **this repo only** (`/src/**`, `/public/**`, `index.html`, root config).
Lovable does **NOT**:
- Modify backend code
- Modify the Cloud Run service
- Modify Supabase schema, RLS, GRANTs, migrations, or edge functions intended to run server-side
- Write or run SQL against the user's Supabase project
- Touch `/axiom/**` (legacy path — backend now lives in a separate repo)

If a frontend change requires a backend change, Lovable **stops and hands a spec to the user** (route, request body, response shape, auth expectation). The user runs it through **Cursor** against the backend repo.

## Backend (separate, NOT editable by Lovable)

- **Repo:** `Axiom-Atlas` (GitHub)
- **Runtime:** Google Cloud Run
- **Base URL:** `https://axiom-atlas-689827072865.us-east1.run.app`
- **Database:** Supabase (the user's own project)
- **Edited by:** Cursor / Claude only

## Frontend (this repo — Lovable's lane)

| Path | Owner |
|---|---|
| `/src/**` | Lovable |
| `/public/**` | Lovable |
| `/index.html` | Lovable |
| `/package.json`, root config | Lovable |
| `/supabase/functions/**` | Lovable may edit (Lovable Cloud edge functions used by frontend) |
| `PROJECT_STRUCTURE.md` | Either, with care |

## Deploy targets

- **Frontend:** Vercel (this repo)
- **Backend:** Google Cloud Run (Axiom-Atlas repo, separate)

## Auth boundary

- Frontend `fetch()` to backend uses `credentials: 'include'`.
- Backend at Cloud Run owns sessions/cookies.
- `useAuth()` calls `GET /api/auth/me` on the Cloud Run base URL.
- Supabase client in `src/integrations/supabase/` is for Lovable Cloud edge functions only — not the primary auth.

## When Lovable needs a backend change

Lovable writes a handoff spec containing:
1. Route + HTTP method
2. Request body shape
3. Expected response shape
4. Auth requirement (cookie? bearer?)
5. Which frontend file/line consumes it

User pastes that into Cursor against the `Axiom-Atlas` repo. Lovable does not attempt the change itself.
