const SIZE_MAP = { sm: 32, md: 48, lg: 64 };
const CIRCLE_SIZE = { sm: 5, md: 7, lg: 9 };

const POSITIONS = [
  { x: 50, y: 50 },
  { x: 50, y: 16 },
  { x: 84, y: 50 },
  { x: 50, y: 84 },
  { x: 16, y: 50 },
];

const ATLAS_PETAL_COLORS = [
  "#C9A24C",
  "#7C3AED",
  "#C9A24C",
  "#6D28D9",
  "#9333EA",
];

function Bloom({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const containerSize = SIZE_MAP[size];
  const circleSize = CIRCLE_SIZE[size];
  const blurPx = circleSize * 0.65;

  return (
    <div style={{ position: "relative", width: containerSize, height: containerSize, flexShrink: 0 }}>
      <style>{`
        @keyframes atlas-bloom-circle {
          0%, 100% { transform: scale(0.25); opacity: 0; }
          35%, 65% { transform: scale(1);    opacity: 1; }
        }
        @keyframes atlas-bloom-blur {
          0%, 100% { transform: scale(0.15); opacity: 0; }
          35%, 65% { transform: scale(1.8);  opacity: 0.38; }
        }
        .bloom-circle { animation: atlas-bloom-circle 1800ms ease-in-out infinite; }
        .bloom-blur   { animation: atlas-bloom-blur   1800ms ease-in-out infinite; }
      `}</style>
      {POSITIONS.map((pos, i) => {
        const c = ATLAS_PETAL_COLORS[i];
        return (
          <div key={i} style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, width: circleSize, height: circleSize, marginLeft: -circleSize / 2, marginTop: -circleSize / 2 }}>
            <div className="bloom-blur" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: c, filter: `blur(${blurPx}px)`, opacity: 0, transform: "scale(0.15)", animationDelay: `${i * 140}ms` }} />
            <div className="bloom-circle" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: c, opacity: 0, transform: "scale(0.25)", animationDelay: `${i * 140}ms` }} />
          </div>
        );
      })}
    </div>
  );
}

export default function BloomSpinner() {
  return (
    <div style={{ minHeight: "100vh", background: "#0C0A09", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 60, fontFamily: "monospace" }}>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Bloom size="sm" />
        <span style={{ fontSize: 10, color: "#78716C", letterSpacing: "0.12em", textTransform: "uppercase" }}>sm — home page empty state</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Bloom size="md" />
        <span style={{ fontSize: 10, color: "#78716C", letterSpacing: "0.12em", textTransform: "uppercase" }}>md — standard</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <Bloom size="lg" />
        <span style={{ fontSize: 10, color: "#78716C", letterSpacing: "0.12em", textTransform: "uppercase" }}>lg — full page load</span>
      </div>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 9, color: "#4B4643", letterSpacing: "0.14em", textTransform: "uppercase" }}>colors</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {["#C9A24C", "#7C3AED", "#6D28D9", "#9333EA"].map((c, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: c }} />
              <span style={{ fontSize: 8, color: "#4B4643" }}>{c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
