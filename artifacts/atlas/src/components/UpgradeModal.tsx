import { useState } from "react";
import { useAtlasProducts, useCheckout, useCustomerPortal, useSubscription } from "../hooks/useSubscription";

interface Props {
  onClose: () => void;
  reason?: "project_limit" | "ledger_history" | "vault" | "github" | "general";
}

const REASON_COPY: Record<string, { title: string; subtitle: string }> = {
  project_limit: {
    title: "You've reached the project limit",
    subtitle: "Free plan includes 1 project. Upgrade to Pro for unlimited projects, permanent vault, and full ledger history.",
  },
  ledger_history: {
    title: "Ledger history requires Pro",
    subtitle: "Free plan keeps decisions for 24 hours. Upgrade to keep everything permanently.",
  },
  vault: {
    title: "Vault requires Pro",
    subtitle: "Permanent vault storage is a Pro feature. Upgrade to keep your decisions across every session.",
  },
  github: {
    title: "GitHub integration requires Pro",
    subtitle: "Connect your repos and use Axiom with your actual codebase — available on Pro.",
  },
  general: {
    title: "Upgrade Axiom",
    subtitle: "Unlock unlimited projects, permanent vault, full ledger history, GitHub integration, and more.",
  },
};

const FEATURES = {
  free: [
    "Unlimited AI calls",
    "1 project",
    "Session-only vault (resets)",
    "Ledger history for 24 hours",
  ],
  pro: [
    "Unlimited projects",
    "Permanent vault",
    "Full ledger history",
    "Project profiles",
    "GitHub integration",
    "Axiom handoff",
  ],
  teams: [
    "Everything in Pro",
    "Shared decision ledger",
    "Team vault",
    "Per-seat collaboration",
  ],
};

export function UpgradeModal({ onClose, reason = "general" }: Props) {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const { data, isLoading } = useAtlasProducts();
  const checkout = useCheckout();
  const portal = useCustomerPortal();
  const { isPro } = useSubscription();

  const copy = REASON_COPY[reason] ?? REASON_COPY.general;

  const products = data?.data ?? [];
  const proProduct = products.find(p => p.metadata?.tier === "pro");
  const teamsProduct = products.find(p => p.metadata?.tier === "teams");

  function getPriceForProduct(product: typeof proProduct, interval: "month" | "year") {
    if (!product) return null;
    return product.prices.find(pr => pr.recurring?.interval === interval) ?? null;
  }

  const proMonthly = getPriceForProduct(proProduct, "month");
  const proAnnual = getPriceForProduct(proProduct, "year");
  const teamsMonthly = getPriceForProduct(teamsProduct, "month");

  const proPrice = billing === "annual" ? proAnnual : proMonthly;
  const teamsPrice = teamsMonthly;

  function formatAmount(cents: number | undefined) {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(0)}`;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(12,10,9,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 560,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          borderRadius: 14,
          padding: "28px 28px 24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          display: "flex", flexDirection: "column", gap: 22,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.3 }}>
              {copy.title}
            </div>
            <div style={{ fontSize: 13, color: "var(--atlas-muted)", marginTop: 5, lineHeight: 1.5, maxWidth: 400 }}>
              {copy.subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {/* Billing toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setBilling("monthly")}
            style={{
              padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: billing === "monthly" ? "1px solid var(--atlas-gold)" : "1px solid var(--atlas-border)",
              background: billing === "monthly" ? "rgba(201,162,76,0.12)" : "transparent",
              color: billing === "monthly" ? "var(--atlas-gold)" : "var(--atlas-muted)",
            }}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            style={{
              padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: billing === "annual" ? "1px solid var(--atlas-gold)" : "1px solid var(--atlas-border)",
              background: billing === "annual" ? "rgba(201,162,76,0.12)" : "transparent",
              color: billing === "annual" ? "var(--atlas-gold)" : "var(--atlas-muted)",
            }}
          >
            Annual
            <span style={{ marginLeft: 5, fontSize: 10, color: "#5A8A5A" }}>Save $38</span>
          </button>
        </div>

        {/* Plan cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {/* Free */}
          <PlanCard
            name="Free"
            price="$0"
            interval=""
            features={FEATURES.free}
            current={!isPro}
            accent={false}
          />

          {/* Pro */}
          <PlanCard
            name="Pro"
            price={isLoading ? "…" : formatAmount(proPrice?.unitAmount)}
            interval={billing === "annual" ? "/yr" : "/mo"}
            features={FEATURES.pro}
            current={false}
            accent={true}
            onUpgrade={proPrice ? () => checkout.mutate(proPrice.id) : undefined}
            loading={checkout.isPending}
          />

          {/* Teams */}
          <PlanCard
            name="Teams"
            price={isLoading ? "…" : formatAmount(teamsPrice?.unitAmount)}
            interval="/seat/mo"
            features={FEATURES.teams}
            current={false}
            accent={false}
            onUpgrade={teamsPrice ? () => checkout.mutate(teamsPrice.id) : undefined}
            loading={checkout.isPending}
          />
        </div>

        {/* Billing portal link for existing subscribers */}
        {isPro && (
          <div style={{ textAlign: "center" }}>
            <button
              onClick={() => portal.mutate()}
              style={{ background: "none", border: "none", color: "var(--atlas-muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
            >
              Manage billing
            </button>
          </div>
        )}

        {/* Fine print */}
        <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, textAlign: "center" }}>
          Stripe test mode — no real charges. Cancel anytime.
        </div>
      </div>
    </div>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  interval: string;
  features: string[];
  current: boolean;
  accent: boolean;
  onUpgrade?: () => void;
  loading?: boolean;
}

function PlanCard({ name, price, interval, features, current, accent, onUpgrade, loading }: PlanCardProps) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: accent ? "1px solid rgba(201,162,76,0.45)" : "1px solid var(--atlas-border)",
        background: accent ? "rgba(201,162,76,0.05)" : "transparent",
        padding: "16px 14px",
        display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: accent ? "var(--atlas-gold)" : "var(--atlas-fg)" }}>
          {name}
        </div>
        <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "var(--atlas-fg)" }}>{price}</span>
          <span style={{ fontSize: 11, color: "var(--atlas-muted)" }}>{interval}</span>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {features.map(f => (
          <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.4 }}>
            <span style={{ color: accent ? "var(--atlas-gold)" : "var(--atlas-muted)", flexShrink: 0, marginTop: 1 }}>✓</span>
            {f}
          </li>
        ))}
      </ul>

      {current ? (
        <div style={{ fontSize: 11, color: "var(--atlas-muted)", textAlign: "center", opacity: 0.6 }}>Current plan</div>
      ) : onUpgrade ? (
        <button
          onClick={onUpgrade}
          disabled={loading}
          style={{
            padding: "7px 0", borderRadius: 7, border: "none", cursor: loading ? "not-allowed" : "pointer",
            background: accent ? "var(--atlas-ember)" : "rgba(255,255,255,0.07)",
            color: accent ? "#fff" : "var(--atlas-fg)",
            fontSize: 12, fontWeight: 600,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Loading…" : `Get ${name}`}
        </button>
      ) : (
        <div style={{ fontSize: 11, color: "var(--atlas-muted)", textAlign: "center", opacity: 0.4 }}>Contact us</div>
      )}
    </div>
  );
}
