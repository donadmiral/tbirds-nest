"use client";
// One rule for every name on web: tier colour on the text and the seal beside it.
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { getTierColor } from "@/lib/tier";

export function PersonName({ name, verified, tier, className, badgeSize = 14 }: { name: string; verified?: boolean | null; tier?: string | null; className?: string; badgeSize?: number }) {
  const color = verified ? getTierColor(tier) : null;
  return (
    <span className={"inline-flex min-w-0 items-center gap-1 " + (className || "")}>
      <span className="truncate" style={color ? { color } : undefined}>{name}</span>
      {verified ? <VerifiedBadge tier={tier} size={badgeSize} /> : null}
    </span>
  );
}