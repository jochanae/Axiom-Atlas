import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "rgba(15,15,20,0.95)",
          border: "1px solid rgba(139,92,246,0.4)",
          color: "#e2e8f0",
          backdropFilter: "blur(12px)",
          borderRadius: 12,
        },
      }}
    />
  </StrictMode>
);