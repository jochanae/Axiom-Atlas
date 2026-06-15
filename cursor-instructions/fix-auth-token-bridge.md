# Fix Auth Loop — Build the /auth/callback Page

## The bug (confirmed)
Google OAuth sign-in works correctly on the backend. After Google authenticates the user, the backend:
1. Creates a session token
2. Sets a session cookie
3. Redirects to `https://axiomsystem.app/auth/callback?token=<token>`

The problem: `/auth/callback` does not exist as a frontend route. The user lands on an unknown URL, gets sent to the landing page, and the token is lost. They appear to never have logged in. This repeats every time they try.

## The fix
Add `/auth/callback` to the frontend router and create the page. It needs to:

1. On mount, read `token` from the URL query string (`?token=...`)
2. Store it — check how the rest of the app stores auth tokens (localStorage key, cookie, etc.) and use the same approach. The backend already sets a session cookie too, so you may only need to navigate to home.
3. Navigate to `/home` after storing the token.

## Exact redirect URL from the backend
```
https://axiomsystem.app/auth/callback?token=<hex_token>
```
The token is a 64-character hex string.

## Files to look in
- The frontend router (wherever `/login`, `/home`, `/project/:id` routes are declared — likely `App.tsx` or a router config file)
- Search for how `token` or session is stored elsewhere in the app after login (email/password login likely does the same thing — find that and mirror it)

## What NOT to change
- The backend Google OAuth flow — it is working correctly.
- Any other pages or routes.
- The login page, session handling, or cookie logic.

## Expected result
User clicks "Sign in with Google" → Google authenticates → backend creates session → redirects to `/auth/callback?token=...` → frontend stores token → navigates to `/home`. No more loop.
