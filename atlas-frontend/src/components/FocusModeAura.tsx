import { AnimatePresence, motion } from "framer-motion";
import type { PortfolioFocus } from "@/lib/portfolioFocusDetection";

interface FocusModeAuraProps {
  focus: PortfolioFocus;
}

const AURA_COLOR_BY_FOCUS: Record<Exclude<PortfolioFocus, "none">, string> = {
  project: "var(--atlas-phosphor)",
  portfolio: "hsl(var(--primary))",
};

export function FocusModeAura({ focus }: FocusModeAuraProps) {
  const active = focus === "project" || focus === "portfolio";
  const color = active ? AURA_COLOR_BY_FOCUS[focus] : "transparent";

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={focus}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: "calc(118px + env(safe-area-inset-bottom, 0px))",
            pointerEvents: "none",
            zIndex: 48,
            overflow: "hidden",
            ["--focus-aura-color" as string]: color,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scaleX: 0.82, x: "-50%" }}
            animate={{ opacity: 1, scaleX: 1, x: "-50%" }}
            exit={{ opacity: 0, scaleX: 0.9, x: "-50%" }}
            transition={{ duration: 0.44, ease: "easeOut" }}
            style={{
              position: "absolute",
              left: "50%",
              bottom: "calc(-78px + env(safe-area-inset-bottom, 0px))",
              width: "min(880px, 112vw)",
              height: 154,
              borderRadius: "50%",
              border: "1px solid color-mix(in oklab, var(--focus-aura-color) 42%, transparent)",
              boxShadow:
                "0 0 32px color-mix(in oklab, var(--focus-aura-color) 30%, transparent), inset 0 0 42px color-mix(in oklab, var(--focus-aura-color) 18%, transparent)",
              background:
                "radial-gradient(ellipse at center, color-mix(in oklab, var(--focus-aura-color) 16%, transparent), transparent 68%)",
            }}
          />
          <motion.span
            initial={{ opacity: 0, x: "-42vw", scale: 0.72 }}
            animate={{
              opacity: [0, 1, 0.55, 0],
              x: ["-42vw", "-8vw", "22vw", "44vw"],
              scale: [0.72, 1, 0.86, 0.68],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.4 }}
            style={{
              position: "absolute",
              left: "50%",
              bottom: "calc(22px + env(safe-area-inset-bottom, 0px))",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--focus-aura-color)",
              boxShadow:
                "0 0 10px var(--focus-aura-color), 0 0 22px color-mix(in oklab, var(--focus-aura-color) 50%, transparent)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
