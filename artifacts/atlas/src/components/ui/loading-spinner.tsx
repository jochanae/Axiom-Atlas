type BloomSize = "sm" | "md" | "lg";
type BloomColor = "atlas" | "ember" | "phosphor";

const SIZE_MAP: Record<BloomSize, number> = { sm: 32, md: 48, lg: 64 };
const CIRCLE_SIZE: Record<BloomSize, number> = { sm: 5, md: 7, lg: 9 };

const COLOR_MAP: Record<BloomColor, string> = {
  atlas: "var(--atlas-gold)",
  ember: "var(--atlas-ember)",
  phosphor: "var(--atlas-phosphor)",
};

// Center + 4 petals (top, right, bottom, left) as % of container
const POSITIONS = [
  { x: 50, y: 50 },
  { x: 50, y: 16 },
  { x: 84, y: 50 },
  { x: 50, y: 84 },
  { x: 16, y: 50 },
];

export function LoadingSpinner({
  size = "md",
  color = "atlas",
}: {
  size?: BloomSize;
  color?: BloomColor;
}) {
  const containerSize = SIZE_MAP[size];
  const circleSize = CIRCLE_SIZE[size];
  const c = COLOR_MAP[color];
  const blurPx = circleSize * 0.65;

  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        position: "relative",
        width: containerSize,
        height: containerSize,
        flexShrink: 0,
      }}
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
          {/* Glow blur layer behind */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: c,
              filter: `blur(${blurPx}px)`,
              opacity: 0,
              transform: "scale(0.15)",
              animation: `atlas-bloom-blur 1800ms ease-in-out ${i * 140}ms infinite`,
            }}
          />
          {/* Main circle */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: c,
              opacity: 0,
              transform: "scale(0.25)",
              animation: `atlas-bloom-circle 1800ms ease-in-out ${i * 140}ms infinite`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
