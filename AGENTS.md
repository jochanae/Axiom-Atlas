# Axiom Development Guide

See [README.md](./README.md) for the full local setup and [CONTRIBUTING.md](./CONTRIBUTING.md) for code conventions.

## Cursor Cloud specific instructions

### Architecture

This is a pnpm workspace monorepo with these key packages:
- `artifacts/api-server` — Express 5 API server (port 8080)
- `artifacts/atlas` — React + Vite frontend (port 3000 by default)
- `lib/db` — Drizzle ORM schema + migrations (PostgreSQL)
- `lib/api-spec` — OpenAPI 3.1 specification (source of truth)
- `lib/api-client-react` — Generated React Query hooks (do NOT edit)
- `lib/api-zod` — Generated Zod schemas (do NOT edit)

### Environment variables

The project does **not** use `dotenv`. You must export env vars before running commands:

```bash
export $(cat .env | xargs)
```

Minimum `.env` for local dev:
```
DATABASE_URL=postgresql://ubuntu:dev_password@localhost:5432/axiom_dev
ANTHROPIC_API_KEY=<real key or placeholder>
SESSION_SECRET=<any random string>
OPENAI_API_KEY=<real key or placeholder>
GOOGLE_GEMINI_API_KEY=<placeholder>
PORT=8080
```

### Running services

```bash
# Start API server (requires env vars exported)
export $(cat .env | xargs) && pnpm --filter @workspace/api-server run dev

# Start frontend (override PORT to avoid conflict with API server)
PORT=3000 pnpm --filter @workspace/atlas run dev
```

**Important**: The Vite frontend config reads the `PORT` env var. If you exported `PORT=8080` for the API server, you must override it when starting the frontend: `PORT=3000 pnpm --filter @workspace/atlas run dev`.

### Running tests

```bash
export $(cat .env | xargs) && pnpm run test
```

The `chat-usage.test.ts` test will fail without a real `ANTHROPIC_API_KEY`.

### Typecheck

```bash
pnpm run typecheck        # Full: libs + all packages
pnpm run typecheck:libs   # Just shared libraries (faster)
```

### Database

PostgreSQL must be running locally. To push schema changes:
```bash
export $(cat .env | xargs) && pnpm --filter @workspace/db run push
```

### Known dev environment caveat

The API server sets session cookies with the `Secure` flag, which means browser-based authentication only works over HTTPS. For local development on `http://localhost`, API-level testing (curl with `-c`/`-b` cookie jars) works for full auth flows, but the browser UI will show "session expired" after login/signup. This does not affect backend development or API testing.

### Related repository

The `atlas-idk` repo (if present at `../atlas-idk`) is the frontend-focused repo with TanStack Start. It embeds this monorepo under its `axiom/` directory. Its root uses `npm` (not pnpm). Run with `npm run dev` from its root.
