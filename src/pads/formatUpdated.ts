/** Coarse "last edited" label for the pad list. */
export function formatUpdated(updatedAt: number, now: number): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
