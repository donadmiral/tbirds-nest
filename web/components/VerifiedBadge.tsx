// The Platinum verified seal. Kept in lockstep with mobile src/components/VerifiedBadge.tsx:
// same seal path, same metals per tier, same optical sizing rules.
//
// Sizing is the whole game with a seal this small. Instagram and X set their
// badge to roughly the cap height of the text beside it, so it reads as
// punctuation rather than as an icon. This renders at exactly the size asked
// for, and drops detail that cannot survive the pixel budget: below 16px the
// hairline stroke and the shine highlight turn to grey mush, so they are left
// out and the check is drawn as a stroked path with round joins, which stays
// crisp at any size instead of collapsing into a blob.
type Tier = "public_figure" | "business" | "official" | string | null | undefined;

// One source of truth for tier colour, matching mobile src/components/VerifiedBadge.tsx.
// The seal metal is derived from the name colour, so a gold name always wears a
// gold seal and a platinum name a platinum one. They cannot drift apart.
export const TIER_COLORS: Record<string, string> = {
  public_figure: "#1D7A38",
  business: "#5B6470",
  official: "#B08D3F",
};

export function getTierColor(tier?: string | null): string | null {
  if (!tier) return null;
  return TIER_COLORS[tier] ?? null;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => (amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount)));
  return "#" + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42;
}

function metalFor(base: string) {
  return {
    grad: [shade(base, 0.72), shade(base, 0.3), base, shade(base, -0.42)],
    check: isLight(base) ? "#12203A" : "#FFFFFF",
  };
}

const METALS: Record<string, { grad: string[]; check: string }> = {
  public_figure: metalFor(TIER_COLORS.public_figure),
  business: metalFor(TIER_COLORS.business),
  official: metalFor(TIER_COLORS.official),
};

// A twelve-lobe rosette, generated rather than traced so every scallop is even.
// The old shape had deep valleys and came to points, which reads as a gear at
// 13px; these lobes are shallow (11.35 out, 9.55 in) so the silhouette stays a
// circle with a decorated edge, the way Instagram's and X's badges do.
const SEAL = "M12.00 0.65Q13.55 0.24 14.47 2.78Q15.73 3.00 17.67 2.17Q19.22 2.59 18.75 5.25Q19.73 6.07 21.83 6.33Q22.96 7.46 21.22 9.53Q21.66 10.73 23.35 12.00Q23.76 13.55 21.22 14.47Q21.00 15.73 21.83 17.67Q21.41 19.22 18.75 18.75Q17.93 19.73 17.68 21.83Q16.54 22.96 14.47 21.22Q13.27 21.66 12.00 23.35Q10.45 23.76 9.53 21.22Q8.27 21.00 6.33 21.83Q4.78 21.41 5.25 18.75Q4.27 17.93 2.17 17.68Q1.04 16.54 2.78 14.47Q2.34 13.27 0.65 12.00Q0.24 10.45 2.78 9.53Q3.00 8.27 2.17 6.33Q2.59 4.78 5.25 5.25Q6.07 4.27 6.32 2.17Q7.46 1.04 9.53 2.78Q10.73 2.34 12.00 0.65Z";
// Centred on the 24 box: x runs 8.2 to 15.8, y runs 9.5 to 14.9.
const CHECK = "M8.2 12.3l2.6 2.6 5-5.4";

export function VerifiedBadge({ tier, size = 14 }: { tier?: Tier; size?: number }) {
  const key = tier && METALS[tier] ? tier : "business";
  const m = METALS[key];
  const px = Math.round(size);
  const detailed = px >= 16;
  const gid = "vbw-" + key;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      className="inline-block shrink-0 align-[-0.1em]"
      role="img"
      aria-label="Verified"
    >
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0" stopColor={m.grad[0]} />
          <stop offset="0.35" stopColor={m.grad[1]} />
          <stop offset="0.7" stopColor={m.grad[2]} />
          <stop offset="1" stopColor={m.grad[3]} />
        </linearGradient>
      </defs>
      <path
        d={SEAL}
        fill={"url(#" + gid + ")"}
        stroke={detailed ? "rgba(255,255,255,0.5)" : undefined}
        strokeWidth={detailed ? 0.4 : undefined}
      />
      {detailed ? (
        <ellipse cx="9" cy="7" rx="3.4" ry="1.7" fill="rgba(255,255,255,0.38)" transform="rotate(-20 9 7)" />
      ) : null}
      <path
        d={CHECK}
        fill="none"
        stroke={m.check}
        strokeWidth={px >= 24 ? 2 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
