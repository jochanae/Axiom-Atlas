# Render Migration

Add the following environment variables from `.env.example` to the Render dashboard for the `axiom-atlas-api` service.

## Required

- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `SESSION_SECRET`

## Optional

### Google OAuth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Stripe billing

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

### GitHub integration

- `GITHUB_TOKEN`
