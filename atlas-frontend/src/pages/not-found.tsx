import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-8"
      style={{ background: "var(--atlas-bg, #0a0a0a)" }}
    >
      <div className="w-full max-w-md text-center">
        <div
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.25)" }}
        >
          <AlertCircle className="h-7 w-7" style={{ color: "var(--atlas-gold, #c9a24c)" }} />
        </div>
        <h1
          className="text-2xl font-semibold tracking-tight"
          style={{ color: "var(--atlas-fg, #f5f5f5)" }}
        >
          404 — Page Not Found
        </h1>
        <p className="mt-3 text-sm" style={{ color: "var(--atlas-muted, #888)" }}>
          The page you're looking for doesn't exist or has moved.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: "rgba(201,162,76,0.12)",
              border: "1px solid rgba(201,162,76,0.35)",
              color: "var(--atlas-gold, #c9a24c)",
            }}
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
