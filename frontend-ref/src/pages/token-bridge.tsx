import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiUrl } from "@/lib/api";
import { takeOauthReturn } from "@/lib/oauthReturn";

const SESSION_TOKEN_STORAGE_KEY = "atlas-auth-token";

type Phase = "exchanging" | "linking" | "finalizing";

// Bridge between any OAuth/connect callback and the workspace. Handles three
// flavours of return URL the backend may send us to:
//   1. ?token=…              — fresh login (set bearer, exchange for cookie)
//   2. ?connected=github     — GitHub connection just linked at the account
//                              level; invalidate `connections` cache and bounce
//                              back to where the user started.
//   3. ?provider=github&…    — same shape, different keying
//   4. ?error=…              — surface to login screen
// In every success path we route to the stashed pre-OAuth location, not /home,
// so users land back on the workspace/project they were configuring.
export default function TokenBridge() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    const bridge = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      const connected = params.get("connected") || params.get("provider");
      const error = params.get("error");
      const explicitReturn = params.get("return_to") || params.get("returnTo");

      // Hard error from upstream — bounce to login with the reason intact.
      if (error) {
        navigate(`/login?reason=${encodeURIComponent(error)}`, { replace: true });
        return;
      }

      // 1) Session token flow (login / signup callback).
      if (token) {
        setPhase("exchanging");
        try {
          localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
        } catch {
          navigate("/login?reason=token_storage_failed", { replace: true });
          return;
        }

        try {
          sessionStorage.setItem("atlas-just-authed", "1");
        } catch { /* non-blocking */ }
        queryClient.removeQueries({ queryKey: ["auth", "me"] });

        setPhase("finalizing");
        try {
          await fetch(
            `${apiUrl("/api/auth/session/exchange")}?token=${encodeURIComponent(token)}`,
            { credentials: "include" },
          );
        } catch (e) {
          console.error("Session exchange error", e);
        }

        const dest = explicitReturn || takeOauthReturn("/home");
        navigate(dest, { replace: true });
        return;
      }

      // 2) Connection-only callback (e.g. GitHub OAuth completed). The token
      //    is held server-side; we just need to refresh the connections cache
      //    so `useGithubPushToken` picks it up immediately.
      if (connected) {
        setPhase("linking");
        queryClient.invalidateQueries({ queryKey: ["connections"] });
        queryClient.removeQueries({ queryKey: ["connections"] });
        // Best-effort: also nudge the session cache so any auth-dependent UI
        // recomputes without a full reload.
        queryClient.invalidateQueries({ queryKey: ["auth", "me"] });

        // Brief delay so the workspace mounts with the fresh connection state
        // rather than racing the redirect.
        await new Promise((r) => setTimeout(r, 250));

        const dest = explicitReturn || takeOauthReturn("/home");
        navigate(dest, { replace: true });
        return;
      }

      // 3) No recognizable payload — don't strand the user on a blank screen.
      //    Honor an explicit return_to, else fall back to anything stashed.
      if (explicitReturn || sessionStorage.getItem("atlas-oauth-return")) {
        const dest = explicitReturn || takeOauthReturn("/home");
        navigate(dest, { replace: true });
        return;
      }

      // Truly nothing to act on — go home (logged-in users) or login (not).
      setErrMsg("No authentication payload received. Redirecting…");
      setTimeout(() => navigate("/home", { replace: true }), 600);
    };

    void bridge();
  }, [navigate, queryClient]);

  const label = errMsg
    ? errMsg
    : phase === "linking"
    ? "Finalizing your secure GitHub connection"
    : phase === "finalizing"
    ? "Opening your workspace"
    : "Signing you in";

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "var(--atlas-bg, #0b0b0d)",
        color: "var(--atlas-fg, #e8e6df)",
      }}
    >
      <LoadingSpinner size="md" />
      <p
        style={{
          margin: 0,
          color: "var(--atlas-muted, #8a8780)",
          fontFamily: "var(--app-font-mono, ui-monospace, monospace)",
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: 420,
          lineHeight: 1.7,
        }}
      >
        {label}
      </p>
    </div>
  );
}
