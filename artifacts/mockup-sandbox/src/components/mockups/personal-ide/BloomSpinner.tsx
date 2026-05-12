const sizeMap = {
  sm: { circle: 18, glow: 40 },
  md: { circle: 48, glow: 110 },
  lg: { circle: 72, glow: 160 },
};

const GRADIENT = "linear-gradient(135deg, #D4AF37 0%, #B8860B 25%, #805AD5 60%, #D4AF37 100%)";
const GLOW     = "rgba(212,175,55,0.4)";
const BLUR_BG  = "radial-gradient(circle, rgba(128,90,213,0.45) 0%, rgba(212,175,55,0.25) 55%, transparent 70%)";

function Bloom({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const config = sizeMap[size];
  const staggerDelay = 0.3;
  return (
    <div className="relative flex items-center justify-center" style={{ width: config.glow, height: config.glow }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={`blur-${i}`} className="absolute rounded-full" style={{ width: config.circle * 0.8, height: config.circle * 0.8, background: BLUR_BG, filter: "blur(16px)", animation: `axiom-bloom-blur 2.5s ease-in-out ${i * staggerDelay}s infinite` }} />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="absolute rounded-full" style={{ width: config.circle, height: config.circle, background: GRADIENT, boxShadow: `0 0 30px ${GLOW}`, animation: `axiom-bloom-circle 2.5s ease-out ${i * staggerDelay}s infinite` }} />
      ))}
    </div>
  );
}

export default function BloomSpinner() {
  return (
    <div style={{ minHeight: "100vh", background: "#0C0A09", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 64 }}>
      <style>{`
        @keyframes axiom-bloom-circle {
          0%   { transform: scale(0.2) rotate(0deg);   opacity: 0; }
          25%  { transform: scale(0.7) rotate(90deg);  opacity: 0.7; }
          35%  { transform: scale(1)   rotate(180deg); opacity: 1; }
          65%  { transform: scale(1)   rotate(270deg); opacity: 1; }
          75%  { transform: scale(1.1) rotate(320deg); opacity: 0.7; }
          100% { transform: scale(1.3) rotate(360deg); opacity: 0; }
        }
        @keyframes axiom-bloom-blur {
          0%   { transform: scale(0.3); opacity: 0; }
          50%  { transform: scale(1.5); opacity: 0.5; }
          100% { transform: scale(2);   opacity: 0; }
        }
      `}</style>

      {(["sm", "md", "lg"] as const).map(size => (
        <div key={size} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Bloom size={size} />
          <span style={{ fontSize: 9, color: "#4B4643", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "monospace" }}>{size}</span>
        </div>
      ))}
    </div>
  );
}
