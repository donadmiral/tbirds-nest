// The Platinum verified seal, identical to mobile src/components/VerifiedBadge.tsx:
// same seal and check paths, same metallic gradients per tier, same shine.
type Tier = "public_figure" | "business" | "official" | string | null | undefined;

const METALS: Record<string, { grad: string[]; check: string }> = {
  public_figure: { grad: ["#D9FBEC", "#4ADE9C", "#059669", "#064E3B"], check: "#FFFFFF" },
  business: { grad: ["#EDEFF3", "#C3C8CF", "#6E7278", "#3F4348"], check: "#FFFFFF" },
  official: { grad: ["#FBF8F0", "#F4EFE4", "#C9BFB0", "#A2977F"], check: "#0B1E3D" },
};

const SEAL = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z";
const CHECK = "M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z";

export function VerifiedBadge({ tier, size = 15 }: { tier?: Tier; size?: number }) {
  const key = tier && METALS[tier] ? tier : "business";
  const m = METALS[key];
  const px = Math.max(Math.round(size * 1.4), 20);
  const gid = "vbw-" + key;
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" className="ml-0.5 shrink-0" aria-label="Verified">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0" stopColor={m.grad[0]} />
          <stop offset="0.35" stopColor={m.grad[1]} />
          <stop offset="0.7" stopColor={m.grad[2]} />
          <stop offset="1" stopColor={m.grad[3]} />
        </linearGradient>
      </defs>
      <path d={SEAL} fill={"url(#" + gid + ")"} stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
      <ellipse cx="9" cy="7" rx="3.4" ry="1.7" fill="rgba(255,255,255,0.38)" transform="rotate(-20 9 7)" />
      <path d={CHECK} fill={m.check} />
    </svg>
  );
}