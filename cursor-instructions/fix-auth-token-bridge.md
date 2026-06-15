# Fix Auth Loop — Build the Token Bridge Page

## The bug
Google OAuth sign-in works on the backend — the user authenticates with Google, and the backend creates a session token and redirects to `/auth/token-bridge` to complete the handoff.

The problem: `/auth/token-bridge` does not exist as a frontend route. So the user lands on a broken URL, the token is thrown away, and they get sent back to the landing page as if they were never logged in. This is the "auth loop."

## The fix
Create a `/auth/token-bridge` page (or route) in the frontend router. It needs to:

1. On mount, read the token from the URL query param (the backend passes it as `?token=...` or in the URL hash — check the backend redirect in `artifacts/api-server/src/routes/google-auth.ts` to confirm the exact param name).
2. Store the token in localStorage or a cookie (however the rest of the app handles auth tokens).
3. Navigate the user to `/home` (or the appropriate post-login destination).

## Files to look in
- The frontend router (wherever routes like `/login`, `/home` are registered — likely `App.tsx` or a router config file)
- `artifacts/api-server/src/routes/google-auth.ts` — check the exact redirect URL and query param name the backend uses when handing off the token

## What NOT to change
- The backend Google OAuth flow — it is working correctly.
- Any other pages or routes.
- The login page itself.

## After building this
The Google OAuth loop should be resolved. User clicks "Sign in with Google" → Google authenticates → backend creates session → redirects to `/auth/token-bridge` → frontend stores token → navigates to home. Done.
