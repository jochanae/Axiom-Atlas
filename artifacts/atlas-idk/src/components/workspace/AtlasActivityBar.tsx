import { useEffect, useState } from "react";

function atlasActivityStatus(content: string): string {
  const narration = content.match(/^NARRATION:(.+)/)?.[1]?.trim();
  if (narration) return narration;
  const planStep = content.match(/PLAN_STEP:\s*(.+)/i)?.[1]?.trim();
  if (planStep) return planStep;
  if (/LINE_PATCH/i.test(content)) return "Patching code...";
  if (/FILE_EDIT/i.test(content)) return "Preparing changes...";
  if (/FILE_READ/i.test(content)) return "Reading files...";
  if (/\b(git|push)\b/i.test(content)) return "Pushing to GitHub...";
  return "";
}

const AMBIENT_STEPS = [
  "Atlas is thinking",
  "Mapping architecture",
  "Aligning multi-agent nodes",
  "Synthesizing workspace blueprint",
  "Tracing decision lineage",
  "Calibrating context gravity",
];

export function AtlasActivityBar({ content }: { content: string; lens?: string }) {
  const resolved = atlasActivityStatus(content);
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (resolved) return; // only cycle when no explicit narration
    const t = setInterval(() => setStepIdx((i) => (i + 1) % AMBIENT_STEPS.length), 2600);
    return () => clearInterval(t);
  }, [resolved]);

  const displayed = resolved || `${AMBIENT_STEPS[stepIdx]}...`;

  return (
    <div
      className="atlas-planetary-thinking"
      style={{
        margin: "2px 0 18px",
        pointerEvents: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        position: "relative",
      }}
    >
      <style>{`
        @keyframes atlasPlanetaryPulse {
          0%, 100% {
            opacity: 0.55;
            text-shadow: 0 0 8px rgba(212, 175, 55, 0.18);
          }
          50% {
            opacity: 0.95;
            text-shadow: 0 0 14px rgba(212, 175, 55, 0.55);
          }
        }
        @keyframes atlasOrbitSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes atlasCoreBloom {
          0%, 100% { box-shadow: 0 0 4px rgba(212,175,55,0.5), 0 0 10px rgba(212,175,55,0.25); }
          50%      { box-shadow: 0 0 8px rgba(212,175,55,0.9), 0 0 18px rgba(212,175,55,0.45); }
        }
        @keyframes atlasTextFade {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .atlas-orbit-system {
          position: relative;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }
        .atlas-orbit-core {
          position: absolute;
          top: 50%; left: 50%;
          width: 4px; height: 4px;
          margin: -2px 0 0 -2px;
          border-radius: 50%;
          background: var(--atlas-gold, #C9A24C);
          animation: atlasCoreBloom 3s ease-in-out infinite;
        }
        .atlas-orbit-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid rgba(212,175,55,0.12);
          animation: atlasOrbitSpin 4.5s linear infinite;
        }
        .atlas-orbit-ring::before {
          content: '';
          position: absolute;
          top: -1.5px; left: 50%;
          width: 2.5px; height: 2.5px;
          margin-left: -1.25px;
          border-radius: 50%;
          background: var(--atlas-gold, #C9A24C);
          box-shadow: 0 0 6px rgba(212,175,55,0.7);
        }
        .atlas-orbit-ring--inner {
          inset: 4px;
          border-color: rgba(212,175,55,0.08);
          animation-duration: 2.8s;
          animation-direction: reverse;
        }
        .atlas-orbit-ring--inner::before {
          width: 2px; height: 2px;
          margin-left: -1px;
          top: -1px;
          background: rgba(212,175,55,0.85);
        }
        .atlas-planetary-text {
          font-family: var(--app-font-mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          color: rgba(255,255,255,0.78);
          animation: atlasPlanetaryPulse 3s ease-in-out infinite;
        }
        .atlas-planetary-text > span {
          display: inline-block;
          animation: atlasTextFade 380ms ease-out;
        }
      `}</style>

      <span className="atlas-orbit-system" aria-hidden>
        <span className="atlas-orbit-ring" />
        <span className="atlas-orbit-ring atlas-orbit-ring--inner" />
        <span className="atlas-orbit-core" />
      </span>

      <span className="atlas-planetary-text">
        <span key={displayed}>{displayed}</span>
      </span>
    </div>
  );
}
