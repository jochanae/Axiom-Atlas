type BloomSize = "sm" | "md" | "lg";
type BloomColor = "atlas" | "ember" | "phosphor";

const SIZE_MAP: Record<BloomSize, number> = { sm: 32, md: 48, lg: 64 };
const CIRCLE_SIZE: Record<BloomSize, number> = { sm: 5, md: 7, lg: 9 };

// Center + 4 petals (top, right, bottom, left) as % of container
const POSITIONS = [
  { x: 50, y: 50 },
  { x: 50, y: 16 },
  { x: 84, y: 50 },
  { x: 50, y: 84 },
  { x: 16, y: 50 },
];

const ATLAS_PETAL_COLORS = [
  "#C9A24C",
  "#C9A24C",
  "#C9A24C",
  "#C9A24C",
  "#C9A24C",
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
  const blurPx = circleSize * 0.65;

  const getColor = (index: number) => {
    if (color === "atlas") return ATLAS_PETAL_COLORS[index];
    if (color === "ember") return "var(--atlas-ember)";
    return "var(--atlas-phosphor)";
  };

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
      {POSITIONS.map((pos, i) => {
        const c = getColor(i);
        return (
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
            {/* Main circle */}
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
        );
      })}
    </div>
  );
}
