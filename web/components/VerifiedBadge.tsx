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

const METALS: Record<string, { grad: string[]; check: string }> = {
  public_figure: { grad: ["#D9FBEC", "#4ADE9C", "#059669", "#064E3B"], check: "#FFFFFF" },
  business: { grad: ["#EDEFF3", "#C3C8CF", "#6E7278", "#3F4348"], check: "#FFFFFF" },
  official: { grad: ["#FBF8F0", "#F4EFE4", "#C9BFB0", "#A2977F"], check: "#0B1E3D" },
};

const SEAL = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z";
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
      className="ml-1 inline-block shrink-0 align-[-0.12em]"
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
