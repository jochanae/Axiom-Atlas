import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster
      theme={document.documentElement.dataset.theme === "parchment" ? "light" : "dark"}
      position="bottom-center"
      offset={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}
      mobileOffset={{
        left: 18,
        right: 18,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)",
      }}
      className="atlas-sonner-toaster"
      toastOptions={{
        className: "atlas-luxury-toast",
        descriptionClassName: "atlas-luxury-toast-description",
        style: {
          background: "var(--atlas-surface)",
          border: "1px solid transparent",
          color: "var(--atlas-fg, #E7E5E4)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: 14,
          fontFamily: "var(--app-font-mono, monospace)",
          fontSize: 12,
          letterSpacing: "0.02em",
          boxShadow: "0 18px 48px rgba(0,0,0,0.62), 0 0 32px rgba(212,175,55,0.08)",
        },
      }}
    />
  </StrictMode>
);