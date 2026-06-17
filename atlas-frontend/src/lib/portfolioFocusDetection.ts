export type PortfolioFocus = "project" | "portfolio" | "none";

export interface PortfolioFocusDetection {
  focus: PortfolioFocus;
  matchedProject?: string;
  score: number;
}

const PROJECT_NAMES = [
  "Compani",
  "CoinsBloom",
  "IntoIQ",
  "PresentQ",
  "SanctumIQ",
  "Axiom",
  "Axiom-Atlas",
] as const;

const PROJECT_NAME_WEIGHT = 2.0;
const PORTFOLIO_WIDE_WEIGHT = 2.0;
const MESSAGE_WINDOW = 8;
const DECAY_AFTER_SIGNAL_FREE_MESSAGES = 4;

const PROJECT_PATTERNS = PROJECT_NAMES.map((name) => ({
  name,
  pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, "i"),
}));

const PORTFOLIO_WIDE_PATTERN =
  /\b(all (my|the) (projects|apps|products)|across (everything|my (projects|apps|products))|every project|which (app|project) should|compare my (apps|products|projects)|portfolio[- ]wide|all of them)\b/i;

let stickyState: PortfolioFocusDetection = { focus: "none", score: 0 };
let signalFreeMessages = 0;
let lastSignature = "";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function signatureFor(messages: string[]) {
  return messages.slice(-MESSAGE_WINDOW).join("\u0000");
}

export function detectPortfolioFocus(recentUserMessages: string[]): PortfolioFocusDetection {
  const windowedMessages = recentUserMessages.slice(-MESSAGE_WINDOW);
  const signature = signatureFor(windowedMessages);
  if (signature === lastSignature) return stickyState;
  lastSignature = signature;

  let projectScore = 0;
  let matchedProject: string | undefined;
  let portfolioScore = 0;

  for (const message of windowedMessages) {
    for (const project of PROJECT_PATTERNS) {
      if (project.pattern.test(message)) {
        projectScore += PROJECT_NAME_WEIGHT;
        matchedProject = project.name;
      }
    }
    if (PORTFOLIO_WIDE_PATTERN.test(message)) {
      portfolioScore += PORTFOLIO_WIDE_WEIGHT;
    }
  }

  const hasProjectSignal = projectScore > 0;
  const hasPortfolioSignal = portfolioScore > 0;

  if (hasProjectSignal && !hasPortfolioSignal && matchedProject) {
    signalFreeMessages = 0;
    stickyState = { focus: "project", matchedProject, score: projectScore };
    return stickyState;
  }

  if (hasPortfolioSignal && !hasProjectSignal) {
    signalFreeMessages = 0;
    stickyState = { focus: "portfolio", score: portfolioScore };
    return stickyState;
  }

  signalFreeMessages += 1;
  if (signalFreeMessages >= DECAY_AFTER_SIGNAL_FREE_MESSAGES) {
    stickyState = { focus: "none", score: 0 };
  }

  return stickyState;
}
