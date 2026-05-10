import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster
      position="top-center"
      toastOptions={{
        style: {
          background: "rgba(28,25,23,0.97)",
          border: "1px solid rgba(201,162,76,0.28)",
          color: "var(--atlas-fg, #E7E5E4)",
          backdropFilter: "blur(16px)",
          borderRadius: 10,
          fontFamily: "var(--app-font-sans, sans-serif)",
          fontSize: 13,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        },
      }}
    />
  </StrictMode>
);