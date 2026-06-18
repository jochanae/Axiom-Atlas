import { useState } from "react";
import { haptics } from "@/lib/haptics";

/**
 * AddToBedrockAffordance — contextual inline action that appears below
 * qualifying Atlas messages in a feeder thread. Tapping promotes the message
 * (or its distilled content) into the attached project's memory.
 *
 * The wiring contract:
 *   - Parent decides visibility (heuristic via `isBedrockCandidate` OR backend flag)
 *   - This component owns the optimistic UI: idle → pushing → pushed
 *   - On success the parent should fire a `pulse` on the relevant FeederBadge
 *     so the header chip + sidebar chip glow gold for ~600ms
 *
 * Backend endpoint expected: POST /api/threads/:threadId/push-to-bedrock
 * with body `{ messageId }`. Wire `onPush` to that call.
 */
interface AddToBedrockAffordanceProps {
  projectTitle: string;
  onPush: () => Promise<void> | void;
}

export function AddToBedrockAffordance({
  projectTitle,
  onPush,
}: AddToBedrockAffordanceProps) {
  const [state, setState] = useState<"idle" | "pushing" | "pushed">("idle");

  const handleClick = async () => {
    if (state !== "idle") return;
    haptics.tap();
    setState("pushing");
    try {
      await onPush();
      setState("pushed");
      setTimeout(() => setState("idle"), 2400);
    } catch {
      setState("idle");
    }
  };

  const label =
    state === "pushed"
      ? `✓ Added to ${projectTitle}'s bedrock`
      : state === "pushing"
        ? "Adding…"
        : `↗ Add to ${projectTitle}'s bedrock`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state !== "idle"}
      className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md transition-all duration-200 hover:bg-[rgba(201,162,76,0.06)]"
      style={{
        background: "transparent",
        border: "1px dashed rgba(201,162,76,0.28)",
        color: state === "pushed" ? "var(--atlas-gold)" : "var(--atlas-muted)",
        fontFamily: "var(--app-font-mono)",
        fontSize: 10,
        letterSpacing: "0.06em",
        lineHeight: 1,
        cursor: state === "idle" ? "pointer" : "default",
      }}
    >
      {label}
    </button>
  );
}
