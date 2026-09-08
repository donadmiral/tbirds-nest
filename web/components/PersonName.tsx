"use client";
// One rule for every name on web: tier colour on the text and the seal beside it.
// Give it a tier when you have one; give it the person's id when you don't.
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { getTierColor } from "@/lib/tier";
import { useTier } from "@/lib/tierLookup";

export function PersonName({ name, verified, tier, userId, className, badgeSize = 14 }: { name: string; verified?: boolean | null; tier?: string | null; userId?: string | null; className?: string; badgeSize?: number }) {
  const looked = useTier(tier === undefined || tier === null ? userId : null);
  const isVerified = verified ?? looked?.verified ?? false;
  const useTierValue = tier ?? looked?.tier ?? null;
  const color = isVerified ? getTierColor(useTierValue) : null;
  return (
    <span className={"inline-flex min-w-0 items-center gap-1 " + (className || "")}>
      <span className="truncate" style={color ? { color } : undefined}>{name}</span>
      {isVerified ? <VerifiedBadge tier={useTierValue} size={badgeSize} /> : null}
    </span>
  );
}