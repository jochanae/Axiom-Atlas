import { FormEvent, useState } from "react";

const features = [
  "Unlimited Atlas conversations",
  "Full decision ledger + flow map",
  "GitHub integration + codebase awareness",
];

export default function PricingPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("submitting");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) throw new Error("Waitlist request failed");
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <main
      className="min-h-screen overflow-hidden px-6 py-10 text-white"
      style={{
        background:
          "radial-gradient(circle at 50% 0%, rgba(201,162,76,0.12), transparent 34%), radial-gradient(circle at 80% 82%, rgba(196,82,26,0.12), transparent 30%), #0C0A09",
        fontFamily: "var(--app-font-sans)",
      }}
    >
      <div className="pointer-events-none fixed inset-0 opacity-[0.045]" style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.42) 1px, transparent 1px)",
        backgroundSize: "72px 72px",
      }} />
      <div className="pointer-events-none fixed inset-0 opacity-[0.04]" style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }} />

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="w-full max-w-2xl rounded-[28px] border border-[#C9A24C]/25 bg-black/35 p-8 shadow-[0_40px_120px_rgba(0,0,0,0.55)] backdrop-blur md:p-12">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.34em] text-[#C9A24C]">
            Axiom pricing
          </p>

          <div className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-5xl font-semibold tracking-[-0.04em] text-[#F5ECDD] md:text-6xl">
                Axiom
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-white/62">
                A dark, strategic workspace for turning conversations into decisions, maps, and shipped code.
              </p>
            </div>
            <div className="shrink-0">
              <span className="text-5xl font-semibold tracking-[-0.05em] text-[#C9A24C]">$29</span>
              <span className="ml-2 text-sm text-white/55">/month</span>
            </div>
          </div>

          <ul className="mb-8 space-y-4">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-white/78">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-[#C9A24C] shadow-[0_0_18px_rgba(201,162,76,0.7)]" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="min-h-12 flex-1 rounded-full border border-white/12 bg-[#0C0A09]/80 px-5 text-sm text-white placeholder:text-white/35"
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              className="min-h-12 rounded-full border border-[#C9A24C]/55 bg-[#C9A24C] px-6 text-sm font-semibold text-[#0C0A09] transition hover:bg-[#d7b764] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "submitting" ? "Joining..." : "Join the waitlist"}
            </button>
          </form>

          <div className="mt-4 min-h-5 text-sm">
            {status === "success" && <p className="text-[#C9A24C]">You're on the waitlist.</p>}
            {status === "error" && <p className="text-red-300">Something went wrong. Please try again.</p>}
          </div>

          <p className="mt-6 border-t border-white/10 pt-6 text-sm text-white/52">
            Early access pricing. Locks in forever.
          </p>
        </div>
      </section>
    </main>
  );
}
