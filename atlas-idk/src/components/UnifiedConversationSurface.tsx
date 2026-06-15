import type React from "react";
import { ChatStream, type ChatStreamProps } from "@/components/workspace/ChatStream";
import { ChatComposer, type ChatComposerProps } from "@/components/workspace/ChatComposer";

/**
 * UnifiedConversationSurface
 *
 * Shared conversational runtime used by both home and project operational
 * states. The conversation (ChatStream + ChatComposer) is the persistent
 * center; operational panels (Flow / Ledger / Files / Preview) mount
 * conditionally around it.
 *
 * This is an ASSEMBLY-ONLY wrapper — it does not change any behavior,
 * styling, or API calls. Layout for the three modes is intentionally
 * minimal in this slice; downstream slices will deepen `mode`-specific
 * presentation. For now, `mode` is forwarded as a `data-surface-mode`
 * attribute for future styling hooks.
 *
 * Operational side panels are accepted as render slots (ReactNode) rather
 * than constructed internally. This keeps the surface decoupled from each
 * panel's specific prop contract and lets callers pre-bind them.
 */
export type UnifiedConversationMode = "ambient" | "active" | "operational";

export interface UnifiedConversationSurfaceProps {
  mode: UnifiedConversationMode;
  projectId?: number | null;

  showFlow?: boolean;
  showLedger?: boolean;
  showFiles?: boolean;
  showPreview?: boolean;

  chatStreamProps?: ChatStreamProps | null;
  composerProps?: ChatComposerProps | null;

  betweenSlot?: React.ReactNode;

  flowPanel?: React.ReactNode;
  ledgerPanel?: React.ReactNode;
  filesPanel?: React.ReactNode;
  previewPanel?: React.ReactNode;

  // Host-owned ReactNode slots. Used by pages whose chat UI predates the
  // extracted ChatStream/ChatComposer components (e.g. home.tsx). When
  // `hostShell` is also provided, the surface delegates wrapper DOM to the
  // host; otherwise the slots stack inside the default ambient/active
  // layout. Either slot may be omitted independently.
  streamSlot?: React.ReactNode;
  composerSlot?: React.ReactNode;

  // Optional render-prop that lets the host preserve its own wrapper DOM
  // while the surface orchestrates slot placement. Invoked whenever the
  // host opts in (any of streamSlot / composerSlot / children present).
  // Receives the resolved conversation slots and the four operational
  // panel slots so the host can weave panels into its existing layout
  // without redesigning each panel.
  hostShell?: (parts: {
    stream: React.ReactNode;
    between: React.ReactNode;
    composer: React.ReactNode;
    panels: {
      flow: React.ReactNode;
      ledger: React.ReactNode;
      files: React.ReactNode;
      preview: React.ReactNode;
    };
  }) => React.ReactNode;

  // Legacy children pass-through. Prefer streamSlot/composerSlot + hostShell
  // for new integrations.
  children?: React.ReactNode;
}

export function UnifiedConversationSurface({
  mode,
  projectId,
  chatStreamProps,
  composerProps,
  betweenSlot,
  showFlow,
  showLedger,
  showFiles,
  showPreview,
  flowPanel,
  ledgerPanel,
  filesPanel,
  previewPanel,
  streamSlot,
  composerSlot,
  hostShell,
  children,
}: UnifiedConversationSurfaceProps) {
  void mode;
  void projectId;

  const panels = {
    flow: flowPanel,
    ledger: ledgerPanel,
    files: filesPanel,
    preview: previewPanel,
  };

  // Host-shell path: when the host provides hostShell, it owns the
  // wrapper DOM. The conversation half can arrive via streamSlot/
  // composerSlot OR via children (used by workspace.tsx to keep the
  // existing chat subtree intact while lifting panels through slots).
  if (hostShell && (streamSlot !== undefined || composerSlot !== undefined || children !== undefined)) {
    const stream = streamSlot !== undefined ? streamSlot : children;
    const content = hostShell({
      stream,
      between: betweenSlot,
      composer: composerSlot,
      panels,
    });
    return (
      <div
        data-surface-mode={mode}
        data-project-id={projectId ?? undefined}
        style={{ display: "contents" }}
      >
        {content}
      </div>
    );
  }

  // Host-slot path without hostShell: stack the slots in default layout.
  if (streamSlot !== undefined || composerSlot !== undefined) {
    return (
      <div
        data-surface-mode={mode}
        data-project-id={projectId ?? undefined}
        style={{ display: "contents" }}
      >
        {streamSlot}
        {betweenSlot}
        {composerSlot}
      </div>
    );
  }

  // Legacy children path (no hostShell, no slots).
  if (children !== undefined) {
    return (
      <div
        data-surface-mode={mode}
        data-project-id={projectId ?? undefined}
        style={{ display: "contents" }}
      >
        {children}
      </div>
    );
  }

  const conversation = (
    <>
      {chatStreamProps ? <ChatStream {...chatStreamProps} /> : null}
      {betweenSlot}
      {composerProps ? <ChatComposer {...composerProps} /> : null}
    </>
  );



  // Operational mode: keep the existing host DOM untouched (workspace.tsx
  // already provides its own full-width layout). Render as a fragment so
  // current visuals are preserved exactly.
  if (mode === "operational") {
    const hasPanels =
      (showFlow && flowPanel) ||
      (showLedger && ledgerPanel) ||
      (showFiles && filesPanel) ||
      (showPreview && previewPanel);

    if (!hasPanels) {
      return (
        <>
          {conversation}
        </>
      );
    }

    return (
      <div
        data-surface-mode={mode}
        data-project-id={projectId ?? undefined}
        style={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
          {conversation}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {showFlow && flowPanel}
          {showLedger && ledgerPanel}
          {showFiles && filesPanel}
          {showPreview && previewPanel}
        </div>
      </div>
    );
  }

  // ambient / active: centered conversation column, no operational panels.
  const maxWidth = mode === "active" ? 780 : 680;

  return (
    <div
      data-surface-mode={mode}
      data-project-id={projectId ?? undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        maxWidth,
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      {conversation}
    </div>
  );
}
