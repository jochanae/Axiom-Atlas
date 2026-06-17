import { useEffect, useMemo, useState } from "react";
import {
  detectPortfolioFocus,
  type PortfolioFocusDetection,
} from "@/lib/portfolioFocusDetection";

const EMPTY_FOCUS: PortfolioFocusDetection = { focus: "none", score: 0 };

export function usePortfolioFocus(recentUserMessages: string[]): PortfolioFocusDetection {
  const signature = useMemo(
    () => recentUserMessages.slice(-8).join("\u0000"),
    [recentUserMessages],
  );
  const [focus, setFocus] = useState<PortfolioFocusDetection>(() =>
    recentUserMessages.length > 0 ? detectPortfolioFocus(recentUserMessages) : EMPTY_FOCUS,
  );

  useEffect(() => {
    setFocus(recentUserMessages.length > 0 ? detectPortfolioFocus(recentUserMessages) : EMPTY_FOCUS);
  }, [recentUserMessages, signature]);

  return focus;
}
