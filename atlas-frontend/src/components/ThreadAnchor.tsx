import { useMemo } from "react";

export interface ThreadAnchorProps {
  text: string;
  meta?: string;
  onClick?: () => void;
}

export function ThreadAnchor({ text, meta, onClick }: ThreadAnchorProps) {
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  const interactive = Boolean(onClick);

  const display = useMemo(() => {
    const trimmed = text.trim();
    if (trimmed.length <= 90) return trimmed;
    return trimmed.slice(0, 87) + "…";
  }, [text]);

  return (
    <Wrapper
      type={interactive ? "button" : undefined}
      onClick={onClick}
      aria-label={interactive ? `Where we were: ${display}` : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 14px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        cursor: interactive ? "pointer" : "default",
        textAlign: "left" as const,
        font: "inherit",
        color: "inherit",
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase" as const,
          color: "var(--muted-text)",
          flexShrink: 0,
        }}
      >
        Where were we
      </span>
      <span
        style={{
          fontSize: 13,
          color: "var(--foreground)",
          letterSpacing: "-0.005em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap" as const,
          minWidth: 0,
          flex: 1,
        }}
      >
        {display}
      </span>
      {meta && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.06em",
            color: "var(--muted-text)",
            flexShrink: 0,
          }}
        >
          {meta}
        </span>
      )}
    </Wrapper>
  );
}
