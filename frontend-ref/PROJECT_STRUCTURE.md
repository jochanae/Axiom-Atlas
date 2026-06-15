# PROJECT_STRUCTURE.md

Lane contract for Atlas (Lovable frontend) + Axiom (Railway/Neon/Drizzle backend).
Both AI tools (Lovable agent and Cursor/Claude) read this file before editing.

## Lanes

| Path | Owner | Tool allowed to edit |
|---|---|---|
| `/src/**` | Frontend | **Lovable only** |
| `/public/**` | Frontend | **Lovable only** |
| `/supabase/**` | Frontend (Lovable Cloud, retired post-cutover) | **Lovable only** |
| `/axiom/artifacts/atlas/**` | TRANSIENT — dissolved into `/src/` during merge | Lovable (during merge only) |
| `/axiom/artifacts/api-server/**` | Backend | **Cursor / Claude only** |
| `/axiom/lib/**` | Backend (Drizzle schema, shared types) | **Cursor / Claude only** |
| `/axiom/pnpm-workspace.yaml` | Backend monorepo config | **Cursor / Claude only** |
| `/axiom/package.json` | Backend monorepo root | **Cursor / Claude only** |
| `/package.json` (repo root) | Frontend | **Lovable only** |
| `PROJECT_STRUCTURE.md` | Both (read before editing) | Either, with care |

**Hard rule:** Lovable does not touch anything under `/axiom/` after the merge completes (except to read shared types via path alias). Cursor does not touch anything under `/src/`.

## Deploy targets

- **Frontend:** Vercel, root = repo root, framework = TanStack Start.
- **Backend:** Railway, root = `axiom/`, install = `pnpm install --frozen-lockfile`, build = `pnpm --filter @workspace/api-server build`, start = `pnpm --filter @workspace/api-server start`.

Two lockfiles (bun.lockb at root, pnpm-lock.yaml in `/axiom/`). Do not unify.

## Auth boundary

**Express session auth (Axiom) wins.** Lovable Cloud auth is retired after cutover.

- Frontend `fetch()` uses `credentials: 'include'`.
- Backend CORS: `Access-Control-Allow-Origin: <frontend-domain>`, `Access-Control-Allow-Credentials: true`.
- Cookie: `SameSite=None; Secure` in production.
- Login/signup POST to `/api/auth/login` on Railway, not Supabase.
- `useAuth()` calls `GET /api/auth/me` (no Supabase SDK in frontend post-cutover).
- `src/integrations/supabase/` is deleted once cutover is verified end-to-end.

## Environment variables

**Frontend (`.env.local`, Vercel env):**
- `VITE_API_URL` — Railway backend URL (dev: `http://localhost:3001`)

**Backend (`.env` in `/axiom/artifacts/api-server/`, Railway env):**
- `DATABASE_URL` — Neon connection string
- `SESSION_SECRET` — Express session secret
- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`

Frontend never sees backend secrets. Lovable never edits backend env.

## Schema / types contract

- Drizzle schema lives in `/axiom/lib/db/`.
- Cursor regenerates shared types after every schema change.
- Frontend imports types via path alias (configured in `tsconfig.json` after merge).
- Schema changes are backend PRs; frontend may need follow-up to consume new fields.

## Risk reminders

- Session cookie cross-origin requires `SameSite=None; Secure` + matching CORS. Test before cutover.
- Railway filter commands MUST use `@workspace/api-server` exactly.
- Keep Supabase auth working in parallel until session auth verified.
