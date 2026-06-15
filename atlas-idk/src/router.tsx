import { createRouter, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { routeTree } from "./routeTree.gen";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const clearRuntimeCaches = () => {
    if (typeof window === "undefined") return;

    try {
      if ("caches" in window) {
        void caches.keys().then((keys) =>
          Promise.all(keys.map((key) => caches.delete(key)))
        );
      }

      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      }
    } catch {
      // noop
    }
  };

  // Auto-reload on stale chunk errors (common after rebuilds)
  if (
    typeof window !== "undefined" &&
    /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS|Loading chunk \d+ failed|Loading CSS chunk/i.test(
      error?.message ?? ""
    )
  ) {
    const key = "__atlas_chunk_reload__";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(key, String(Date.now()));
      clearRuntimeCaches();
      window.location.reload();
      return null;
    }
  }

  const report = [
    `Error: ${error?.name ?? "Error"}: ${error?.message ?? "(no message)"}`,
    `URL: ${typeof window !== "undefined" ? window.location.href : "n/a"}`,
    `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
    `Time: ${new Date().toISOString()}`,
    "",
    "Stack:",
    error?.stack ?? "(no stack)",
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-2xl">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            An unexpected error occurred. Copy the details below and share them to get help.
          </p>
        </div>

        <div className="mt-6 overflow-hidden rounded-md border border-border bg-muted">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-mono text-xs text-muted-foreground">error details</span>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="max-h-[40vh] overflow-auto p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap break-words">
            {report}
          </pre>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              clearRuntimeCaches();
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
