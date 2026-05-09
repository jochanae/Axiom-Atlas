import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export interface SubscriptionStatus {
  subscription: Record<string, unknown> | null;
  tier: string;
}

async function fetchSubscription(): Promise<SubscriptionStatus> {
  const res = await fetch("/api/stripe/subscription", { credentials: "include" });
  if (!res.ok) return { subscription: null, tier: "free" };
  return res.json();
}

async function fetchProducts() {
  const res = await fetch("/api/stripe/products");
  if (!res.ok) throw new Error("Failed to load products");
  return res.json() as Promise<{ data: AtlasProduct[] }>;
}

export interface AtlasPrice {
  id: string;
  unitAmount: number;
  currency: string;
  recurring: { interval: string } | null;
  metadata: Record<string, string> | null;
}

export interface AtlasProduct {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, string> | null;
  prices: AtlasPrice[];
}

export function useSubscription() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["stripe", "subscription"],
    queryFn: fetchSubscription,
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const tier = data?.tier ?? user?.subscriptionTier ?? "free";
  const isPro = tier === "pro" || tier === "teams";
  const isFree = !isPro;

  return { tier, isPro, isFree, subscription: data?.subscription ?? null, isLoading };
}

export function useAtlasProducts() {
  return useQuery({
    queryKey: ["stripe", "products"],
    queryFn: fetchProducts,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: async (priceId: string) => {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (!res.ok) throw new Error("Failed to start checkout");
      const data = await res.json() as { url: string };
      window.location.href = data.url;
    },
  });
}

export function useCustomerPortal() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to open billing portal");
      const data = await res.json() as { url: string };
      window.location.href = data.url;
    },
  });
}
