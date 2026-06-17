type BloomSize = "sm" | "md" | "lg";
type BloomColor = "atlas" | "ember" | "phosphor";

// ── Small / Medium: 5-dot cross bloom (all gold) ─────────────────────────────

const SIZE_MAP: Record<"sm" | "md", number> = { sm: 32, md: 48 };
const CIRCLE_SIZE: Record<"sm" | "md", number> = { sm: 5, md: 7 };

const POSITIONS = [
  { x: 50, y: 50 },
  { x: 50, y: 16 },
  { x: 84, y: 50 },
  { x: 50, y: 84 },
  { x: 16, y: 50 },
];

const COLOR_MAP: Record<BloomColor, string> = {
  atlas: "#C9A24C",
  ember: "var(--atlas-ember)",
  phosphor: "var(--atlas-phosphor)",
};

// ── Large: original Axiom bloom (overlapping circles, gold→purple gradient) ──

const AXIOM_GRADIENT =
  "linear-gradient(135deg, #D4AF37 0%, #B8860B 25%, #805AD5 60%, #D4AF37 100%)";
const AXIOM_GLOW = "rgba(212,175,55,0.4)";
const AXIOM_BLUR =
  "radial-gradient(circle, rgba(128,90,213,0.45) 0%, rgba(212,175,55,0.25) 55%, transparent 70%)";

function AxiomBloom({ text }: { text?: string }) {
  const circleSize = 72;
  const glowSize = 160;
  const staggerDelay = 0.3;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div
        role="status"
        aria-label="Loading"
        style={{ position: "relative", width: glowSize, height: glowSize, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {/* Blurred background orbs */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={`blur-${i}`}
            style={{
              position: "absolute",
              borderRadius: "50%",
              width: circleSize * 0.8,
              height: circleSize * 0.8,
              background: AXIOM_BLUR,
              filter: "blur(16px)",
              animation: `axiomBloomBlur 2.5s ease-in-out ${i * staggerDelay}s infinite`,
            }}
          />
        ))}
        {/* 5 overlapping circles with staggered bloom */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              borderRadius: "50%",
              width: circleSize,
              height: circleSize,
              background: AXIOM_GRADIENT,
              boxShadow: `0 0 30px ${AXIOM_GLOW}`,
              animation: `axiomBloomCircle 2.5s ease-out ${i * staggerDelay}s infinite`,
            }}
          />
        ))}
      </div>
      {text && (
        <p style={{ fontSize: 13, color: "rgba(212,175,55,0.7)", margin: 0 }}>{text}</p>
      )}
      <style>{`
        @keyframes axiomBloomCircle {
          0%   { transform: scale(0.2) rotate(0deg);   opacity: 0; }
          25%  { transform: scale(0.7) rotate(90deg);  opacity: 0.7; }
          35%  { transform: scale(1)   rotate(180deg); opacity: 1; }
          65%  { transform: scale(1)   rotate(270deg); opacity: 1; }
          75%  { transform: scale(1.1) rotate(320deg); opacity: 0.7; }
          100% { transform: scale(1.3) rotate(360deg); opacity: 0; }
        }
        @keyframes axiomBloomBlur {
          0%   { transform: scale(0.3); opacity: 0; }
          50%  { transform: scale(1.5); opacity: 0.5; }
          100% { transform: scale(2);   opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Unified export ────────────────────────────────────────────────────────────

export function LoadingSpinner({
  size = "md",
  color = "atlas",
  text,
}: {
  size?: BloomSize;
  color?: BloomColor;
  text?: string;
}) {
  if (size === "lg") return <AxiomBloom text={text} />;

  const containerSize = SIZE_MAP[size];
  const circleSize = CIRCLE_SIZE[size];
  const c = COLOR_MAP[color];
  const blurPx = circleSize * 0.65;

  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ position: "relative", width: containerSize, height: containerSize, flexShrink: 0 }}
    >
      {POSITIONS.map((pos, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            width: circleSize,
            height: circleSize,
            marginLeft: -circleSize / 2,
            marginTop: -circleSize / 2,
          }}
        >
          <div
            aria-hidden
            className="atlas-bloom-blur"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: c,
              filter: `blur(${blurPx}px)`,
              opacity: 0,
              transform: "scale(0.15)",
              animationDelay: `${i * 140}ms`,
            }}
          />
          <div
            className="atlas-bloom-circle"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: c,
              opacity: 0,
              transform: "scale(0.25)",
              animationDelay: `${i * 140}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
