// Persist where the user was before an OAuth redirect (login, GitHub connect,
// etc.) so the post-callback bridge can land them back on the same screen
// instead of dumping them on /home.
const KEY = "atlas-oauth-return";

export function stashOauthReturn(path?: string) {
  try {
    const target = path ?? (window.location.pathname + window.location.search);
    if (target && target !== "/auth/token-bridge" && target !== "/auth/callback") {
      sessionStorage.setItem(KEY, target);
    }
  } catch {
    // sessionStorage may be unavailable (privacy mode); non-fatal.
  }
}

export function takeOauthReturn(fallback = "/home"): string {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v || fallback;
  } catch {
    return fallback;
  }
}
