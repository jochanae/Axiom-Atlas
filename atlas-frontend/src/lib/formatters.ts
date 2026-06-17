function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

function diffStat(original: string | null, next: string): { additions: number; deletions: number } {
  if (!original) return { additions: next.split("\n").filter(l => l.trim()).length, deletions: 0 };
  // Bag-of-lines approach: O(n), handles repeated lines correctly
  const bag = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const aBag = bag(original);
  const bBag = bag(next);
  let deletions = 0;
  for (const [l, c] of aBag) { const bc = bBag.get(l) ?? 0; if (c > bc) deletions += c - bc; }
  let additions = 0;
  for (const [l, c] of bBag) { const ac = aBag.get(l) ?? 0; if (c > ac) additions += c - ac; }
  return { additions, deletions };
}

function formatCommitTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export { timeAgo, diffStat, formatCommitTimeAgo };
