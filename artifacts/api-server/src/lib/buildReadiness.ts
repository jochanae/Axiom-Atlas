import { db, applicationModelsTable, designPlansTable, projectDnaTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export interface ReadinessCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  explanation: string;
}

export interface BuildReadinessResult {
  ready: boolean;
  confidence: number;
  checks: ReadinessCheck[];
  summary: string;
  originalMessage?: string;
}

// Known antonym pairs used to detect AM↔DNA tone contradictions
const ANTONYM_PAIRS: [string, string][] = [
  ["minimal", "maximalist"],
  ["minimal", "elaborate"],
  ["minimal", "complex"],
  ["dark", "light"],
  ["dark", "bright"],
  ["serious", "playful"],
  ["formal", "casual"],
  ["formal", "playful"],
  ["technical", "approachable"],
  ["technical", "friendly"],
  ["dense", "spacious"],
  ["compact", "airy"],
  ["clinical", "warm"],
  ["corporate", "playful"],
];

function tokenize(arr: string[]): string[] {
  return arr.flatMap((s) => s.toLowerCase().split(/[\s,/-]+/));
}

export async function checkBuildReadiness(projectId: number): Promise<BuildReadinessResult> {
  const [amRows, planRows, dnaRows] = await Promise.all([
    db
      .select()
      .from(applicationModelsTable)
      .where(eq(applicationModelsTable.projectId, projectId))
      .limit(1),
    db
      .select()
      .from(designPlansTable)
      .where(eq(designPlansTable.projectId, projectId))
      .orderBy(desc(designPlansTable.version))
      .limit(1),
    db
      .select()
      .from(projectDnaTable)
      .where(eq(projectDnaTable.projectId, projectId))
      .limit(1),
  ]);

  const model = amRows[0] ?? null;
  const dna = dnaRows[0] ?? null;
  const plan = planRows[0] ?? null;
  const checks: ReadinessCheck[] = [];

  // ── Check 1: Requirements present ─────────────────────────────────────────
  const identity = (model?.identity as Record<string, unknown>) ?? {};
  const intent = (model?.intent as Record<string, unknown>) ?? {};
  const hasIdentity = !!(identity.name || identity.purpose);
  const hasIntent = !!(intent.summary || (intent.coreProblems as unknown[])?.length);

  if (hasIdentity && hasIntent) {
    const name = (identity.name as string) ?? "Project";
    const summary = (intent.summary as string ?? "").slice(0, 80);
    checks.push({
      name: "Requirements present",
      status: "pass",
      explanation: `${name}: ${summary || "intent captured"}`,
    });
  } else if (hasIdentity || hasIntent) {
    checks.push({
      name: "Requirements present",
      status: "warn",
      explanation: hasIdentity
        ? "Project named but intent is thin — Builder may miss context"
        : "Intent captured but project identity is unclear",
    });
  } else {
    checks.push({
      name: "Requirements present",
      status: "fail",
      explanation: "No project identity or intent found — Builder will have to invent the purpose",
    });
  }

  // ── Check 2: Experience Intent confirmed ───────────────────────────────────
  const experienceIntent = (dna?.experienceIntent as Record<string, unknown>) ?? {};
  const dnaStatus = (dna?.status as Record<string, string>) ?? {};
  // Check confirmation via status field (confirmed/committed = explicit user action)
  // Falls back to lastConfirmed for backwards compatibility with pre-DNA-table records
  const STRONG_STATUSES = new Set(["confirmed", "committed"]);
  const eiFieldsConfirmed = ["emotionalRegister", "interactionPosture", "visualLanguage", "designPrinciples"]
    .some((k) => STRONG_STATUSES.has(dnaStatus[k] ?? ""));
  const eiConfirmed = eiFieldsConfirmed || !!(experienceIntent.lastConfirmed);
  const eiConfidence = (experienceIntent.confidence as number) ?? 0;
  const hasEI = (experienceIntent.emotionalRegister as string[] | undefined)?.length ||
    (experienceIntent.interactionPosture as string[] | undefined)?.length ||
    (experienceIntent.visualLanguage as string[] | undefined)?.length ||
    (experienceIntent.designPrinciples as string[] | undefined)?.length;

  if (eiConfirmed && (hasEI || eiConfidence >= 60)) {
    const register = (experienceIntent.emotionalRegister as string[] | undefined)?.join(", ") ?? "";
    checks.push({
      name: "Experience Intent confirmed",
      status: "pass",
      explanation: `${register || "aesthetic confirmed"} — user confirmed`,
    });
  } else if (hasEI) {
    checks.push({
      name: "Experience Intent confirmed",
      status: "warn",
      explanation: `Experience intent inferred but not confirmed (${eiConfidence ? `confidence ${eiConfidence}%` : "edit & save in Soul tab to confirm"}) — Builder will make visual guesses`,
    });
  } else {
    checks.push({
      name: "Experience Intent confirmed",
      status: "warn",
      explanation: "No experience intent — Builder will default to generic visual decisions",
    });
  }

  // ── Check 3: Design Plan committed ────────────────────────────────────────
  if (plan?.status === "committed") {
    checks.push({
      name: "Design Plan committed",
      status: "pass",
      explanation: `v${plan.version} committed — layout and interaction decisions locked`,
    });
  } else if (plan?.status === "proposed") {
    checks.push({
      name: "Design Plan committed",
      status: "warn",
      explanation: "Design Plan exists but not committed — Builder will have to invent layout decisions",
    });
  } else {
    checks.push({
      name: "Design Plan committed",
      status: "warn",
      explanation: "No Design Plan — Builder will have to invent visual and interaction decisions from scratch",
    });
  }

  // ── Check 4: Responsive intent declared ───────────────────────────────────
  const planBody = (plan?.body as Record<string, unknown>) ?? {};
  const responsiveIntent = (planBody.responsiveIntent as Record<string, unknown>) ?? {};
  const hasResponsive = !!(responsiveIntent.mobile || responsiveIntent.desktop);

  if (plan?.status === "committed" && hasResponsive) {
    checks.push({
      name: "Responsive intent declared",
      status: "pass",
      explanation: "Mobile and desktop layout approaches specified",
    });
  } else if (hasResponsive) {
    checks.push({
      name: "Responsive intent declared",
      status: "warn",
      explanation: "Responsive intent specified but Design Plan not committed",
    });
  } else {
    checks.push({
      name: "Responsive intent declared",
      status: "warn",
      explanation: "No responsive intent — Builder will pick breakpoints arbitrarily",
    });
  }

  // ── Check 5: Design principles captured ───────────────────────────────────
  const creativePrinciples = (dna?.creativePrinciples as string[]) ?? [];
  if (creativePrinciples.length >= 2) {
    checks.push({
      name: "Design principles captured",
      status: "pass",
      explanation: `${creativePrinciples.length} principles — e.g. "${(creativePrinciples[0] ?? "").slice(0, 60)}"`,
    });
  } else if (creativePrinciples.length === 1) {
    checks.push({
      name: "Design principles captured",
      status: "warn",
      explanation: "Only 1 principle captured — richer constraints help Builder make better decisions",
    });
  } else {
    checks.push({
      name: "Design principles captured",
      status: "warn",
      explanation: "No creative principles — Builder will make style and tone decisions without guidance",
    });
  }

  // ── Check 6: AM↔DNA consistency (contradiction detection) ─────────────────
  // Compares Experience Intent emotional register + Design Plan tone signals.
  // Detects known antonym pairs that indicate contradictory directives.
  const eiRegister = tokenize(
    (experienceIntent.emotionalRegister as string[] | undefined) ?? []
  );
  const eiDesignPrinciples = tokenize(
    (experienceIntent.designPrinciples as string[] | undefined) ?? []
  );
  const planTone = tokenize(
    typeof planBody.tone === "string"
      ? [planBody.tone]
      : (planBody.tone as string[] | undefined) ?? []
  );
  const planStyle = tokenize(
    typeof planBody.style === "string"
      ? [planBody.style]
      : (planBody.style as string[] | undefined) ?? []
  );
  const dnaSide = [...eiRegister, ...eiDesignPrinciples, ...tokenize(creativePrinciples)];
  const planSide = [...planTone, ...planStyle];
  const allTerms = [...dnaSide, ...planSide];

  const contradictions = ANTONYM_PAIRS.filter(([a, b]) => {
    const hasA = allTerms.some((t) => t.includes(a));
    const hasB = allTerms.some((t) => t.includes(b));
    if (!hasA || !hasB) return false;
    const aInDna = dnaSide.some((t) => t.includes(a));
    const bInDna = dnaSide.some((t) => t.includes(b));
    const aInPlan = planSide.some((t) => t.includes(a));
    const bInPlan = planSide.some((t) => t.includes(b));
    return (aInDna && bInPlan) || (bInDna && aInPlan);
  });

  if (!model && !plan) {
    checks.push({
      name: "AM–DNA consistency",
      status: "warn",
      explanation: "No Application Model or Design Plan to verify consistency between",
    });
  } else if (contradictions.length > 0) {
    const pairs = contradictions.map(([a, b]) => `"${a}" vs "${b}"`).join(", ");
    checks.push({
      name: "AM–DNA consistency",
      status: "fail",
      explanation: `Conflicting tone signals detected: ${pairs}`,
    });
  } else if (dnaSide.length === 0 && planSide.length === 0) {
    checks.push({
      name: "AM–DNA consistency",
      status: "warn",
      explanation: "Cannot verify consistency — tone signals absent from both DNA and Design Plan",
    });
  } else if (dnaSide.length === 0 || planSide.length === 0) {
    checks.push({
      name: "AM–DNA consistency",
      status: "warn",
      explanation:
        dnaSide.length === 0
          ? "DNA has no tone signals to verify against the Design Plan"
          : "Design Plan has no explicit tone signals to verify against DNA",
    });
  } else {
    checks.push({
      name: "AM–DNA consistency",
      status: "pass",
      explanation: "Experience Intent and Design Plan tone signals are consistent",
    });
  }

  // ── Readiness decision ─────────────────────────────────────────────────────
  // All four pillars must be confirmed for a green gate:
  //   • Requirements present (pass)
  //   • Experience Intent confirmed (pass)
  //   • Design Plan committed (pass) — implies responsive intent also present
  //   • Responsive intent declared (pass)
  //   • No AM↔DNA contradiction (not "fail")
  // Any unresolved warn on EI, Design Plan, or responsive intent keeps gate amber.
  const failCount = checks.filter((c) => c.status === "fail").length;
  const passCount = checks.filter((c) => c.status === "pass").length;
  const total = checks.length;
  const confidence = Math.round((passCount / total) * 100);

  const eiStatus = checks.find((c) => c.name === "Experience Intent confirmed")?.status;
  const designPlanStatus = checks.find((c) => c.name === "Design Plan committed")?.status;
  const responsiveStatus = checks.find((c) => c.name === "Responsive intent declared")?.status;
  const consistencyStatus = checks.find((c) => c.name === "AM–DNA consistency")?.status;

  const ready =
    failCount === 0 &&
    eiStatus === "pass" &&
    designPlanStatus === "pass" &&
    responsiveStatus === "pass" &&
    consistencyStatus !== "fail";

  // ── Summary for preflight banner ──────────────────────────────────────────
  const lockedParts: string[] = [];
  if (hasIdentity && identity.name) lockedParts.push(identity.name as string);
  if (intent.summary) lockedParts.push((intent.summary as string).slice(0, 60));
  if (plan?.status === "committed") lockedParts.push(`Design Plan v${plan.version}`);
  if (eiConfirmed) {
    const register = (experienceIntent.emotionalRegister as string[] | undefined)
      ?.slice(0, 2)
      .join(", ");
    if (register) lockedParts.push(register);
  }
  const summary =
    lockedParts.length > 0 ? lockedParts.join(" · ") : "Building from current context";

  return { ready, confidence, checks, summary };
}
