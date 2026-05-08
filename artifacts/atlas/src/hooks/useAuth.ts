import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect } from "react";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: "user" | "admin" | "super_admin";
  subscriptionTier: string;
}

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Auth check failed");
  return res.json() as Promise<AuthUser>;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return { user: user ?? null, isLoading };
}

export function useRequireAuth() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!isLoading && !user) navigate("/login");
  }, [user, isLoading, navigate]);
  return { user, isLoading };
}

export function useLogout() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    queryClient.setQueryData(["auth", "me"], null);
    navigate("/login");
  };
}

export function isSuperAdmin(user: AuthUser | null) {
  return user?.role === "super_admin";
}

export function isAdmin(user: AuthUser | null) {
  return user?.role === "super_admin" || user?.role === "admin";
}
