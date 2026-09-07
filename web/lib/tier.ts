// Tier colours, usable on the server and in the browser. The badge and every
// coloured name read from here so a gold seal always sits by a gold name.
export const TIER_COLORS: Record<string, string> = {
  public_figure: "#1D7A38",
  business: "#5B6470",
  official: "#B08D3F",
};
export function getTierColor(tier?: string | null): string | null {
  if (!tier) return null;
  return TIER_COLORS[tier] ?? null;
}