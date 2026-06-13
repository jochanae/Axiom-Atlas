export interface UserProfile {
  name: string;
  stack: string;
  projects: string;
  notes: string;
  photoUrl?: string;
}

export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem("atlas-user-profile");
    if (raw) return JSON.parse(raw);
  } catch {
    /* noop */
  }
  return {
    name: "",
    stack: "React, React Router, Tailwind CSS, Supabase",
    projects: "Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, Atlas",
    notes: "",
    photoUrl: "",
  };
}

export function saveProfile(p: UserProfile) {
  try {
    localStorage.setItem("atlas-user-profile", JSON.stringify(p));
  } catch {
    /* noop */
  }
}

export function profileToString(p: UserProfile): string {
  const parts: string[] = [];
  if (p.name) parts.push(`Name: ${p.name}`);
  if (p.stack) parts.push(`Stack: ${p.stack}`);
  if (p.projects) parts.push(`Projects: ${p.projects}`);
  if (p.notes) parts.push(`Notes: ${p.notes}`);
  return parts.join("\n");
}
