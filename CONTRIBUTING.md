# Contributing to Axiom

Thanks for your interest. Axiom is a focused system — contributions are welcome when they serve the core purpose: helping founders and builders make decisions they won't regret.

## Before You Start

Read the [README](./README.md) fully. Understand what Axiom is trying to be before proposing changes to it.

## Development Setup

See [README — Local Setup](./README.md#local-setup) for the full environment guide.

Quick version:

```bash
git clone <repo>
pnpm install
cp .env.example .env        # fill in required values
pnpm --filter @workspace/db run push
# Start both workflows in Replit, or:
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/atlas run dev
```

## Project Structure

```
artifacts/atlas/        React + Vite frontend (/)
artifacts/api-server/   Express 5 API server (/api)
lib/db/                 Drizzle ORM schema + migrations
lib/api-spec/           OpenAPI spec (source of truth for the API contract)
lib/api-client-react/   Generated React Query hooks (do not edit manually)
lib/api-zod/            Generated Zod schemas (do not edit manually)
```

The API contract is defined in `lib/api-spec/`. After changing the spec, regenerate clients:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## What to Work On

**Good contributions:**
- Bug fixes with a clear reproduction case
- Performance improvements with measurable impact
- Accessibility improvements
- Mobile layout fixes
- Test coverage for API routes

**Check first:**
- New features that change the core decision enforcement flow
- UI redesigns — the design system is intentional
- New dependencies — the bundle is already watched carefully

**Not accepted:**
- Changes that weaken the Decision Catch Engine logic
- UI changes that add noise without adding signal
- Feature parity with general-purpose AI chat tools (that's not what this is)

## Code Conventions

- **No `console.log` in server code.** Use `req.log` in route handlers, `logger` elsewhere.
- **Zod validation on all API inputs.** Use the generated schemas from `lib/api-zod/`.
- **TypeScript strict mode.** All new code must pass `pnpm run typecheck`.
- **No unused imports.** Keep files clean.
- **React Query for all data fetching.** No raw fetch calls in components.

## Submitting Changes

1. Fork and create a branch: `git checkout -b fix/your-description`
2. Make your changes
3. Run `pnpm run typecheck` — must pass with zero errors
4. Open a pull request with a clear description of what changed and why
5. Reference any related issues

## Code Review

PRs are reviewed for:
- Does it serve the product vision?
- Does it pass typecheck?
- Is it the simplest implementation that works?
- Does it follow the conventions above?

## Questions

Open a GitHub Discussion or reach out at [axiomsystem.app](https://axiomsystem.app).
