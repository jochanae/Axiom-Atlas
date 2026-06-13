import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { setAuthToken } from "@/hooks/useAuth";

// OAuth providers redirect here with a bearer token after the backend sets the
// `atlas-session` cookie. Store the token so API calls can authenticate across
// origins, then continue to the app.
export default function AuthCallback() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) {
      setAuthToken(token);
      try {
        sessionStorage.setItem("atlas-just-authed", "1");
      } catch {
        // This flag only controls the welcome toast, so storage failures are non-blocking.
      }
      queryClient.removeQueries({ queryKey: ["auth", "me"] });
    }
    navigate("/home", { replace: true });
  }, [navigate, queryClient]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--atlas-bg)",
        color: "var(--atlas-fg)",
      }}
    >
      <LoadingSpinner size="md" />
      <p
        style={{
          margin: 0,
          color: "var(--atlas-muted)",
          fontFamily: "var(--app-font-mono)",
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        Signing you in
      </p>
    </div>
  );
}
