/**
 * VerifiedBadge - the metals of Platinum Circles verification, cut in the
 * classic scalloped seal and nothing else. Green: public figures and
 * renowned educators. Space grey: verified businesses. Platinum: officials,
 * government, and the founder.
 *
 *   <VerifiedBadge tier={tier} />          when the screen already has the tier
 *   <VerifiedBadge userId={profileId} />   anywhere else - self lookup, cached,
 *                                          renders nothing for the unverified.
 */
import React, { useEffect, useState } from 'react';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Ellipse } from 'react-native-svg';
import { supabase } from '../services/supabase';

type Tier = 'public_figure' | 'business' | 'official' | null | undefined;

const METALS: Record<string, { grad: string[]; check: string }> = {
  public_figure: { grad: ['#D9FBEC', '#4ADE9C', '#059669', '#064E3B'], check: '#FFFFFF' },
  business: { grad: ['#EDEFF3', '#C3C8CF', '#6E7278', '#3F4348'], check: '#FFFFFF' },
  official: { grad: ['#FBF8F0', '#F4EFE4', '#C9BFB0', '#A2977F'], check: '#0B1E3D' },
};

// A twelve-lobe rosette, generated rather than traced so every scallop is even.
// The old shape had deep valleys and came to points, which reads as a gear at
// 13px; these lobes are shallow (11.35 out, 9.55 in) so the silhouette stays a
// circle with a decorated edge, the way Instagram's and X's badges do.
const SEAL = 'M12.00 0.65Q13.55 0.24 14.47 2.78Q15.73 3.00 17.67 2.17Q19.22 2.59 18.75 5.25Q19.73 6.07 21.83 6.33Q22.96 7.46 21.22 9.53Q21.66 10.73 23.35 12.00Q23.76 13.55 21.22 14.47Q21.00 15.73 21.83 17.67Q21.41 19.22 18.75 18.75Q17.93 19.73 17.68 21.83Q16.54 22.96 14.47 21.22Q13.27 21.66 12.00 23.35Q10.45 23.76 9.53 21.22Q8.27 21.00 6.33 21.83Q4.78 21.41 5.25 18.75Q4.27 17.93 2.17 17.68Q1.04 16.54 2.78 14.47Q2.34 13.27 0.65 12.00Q0.24 10.45 2.78 9.53Q3.00 8.27 2.17 6.33Q2.59 4.78 5.25 5.25Q6.07 4.27 6.32 2.17Q7.46 1.04 9.53 2.78Q10.73 2.34 12.00 0.65Z';
// Centred on the 24 box and drawn as a stroke, so it stays crisp at 13px
// instead of collapsing into a blob the way a filled check does.
const CHECK = 'M8.2 12.3l2.6 2.6 5-5.4';

const tierCache = new Map<string, Tier | false>();
const inFlight = new Map<string, Promise<Tier | false>>();

async function lookupTier(userId: string): Promise<Tier | false> {
  if (tierCache.has(userId)) return tierCache.get(userId)!;
  if (inFlight.has(userId)) return inFlight.get(userId)!;
  const p = (async () => {
    try {
      const { data } = await supabase.from('profiles').select('is_verified, verified_tier').eq('id', userId).maybeSingle();
      const t: Tier | false = data?.verified_tier ? (data.verified_tier as Tier) : (data?.is_verified ? 'business' : false);
      tierCache.set(userId, t);
      return t;
    } catch { return false; }
    finally { inFlight.delete(userId); }
  })();
  inFlight.set(userId, p);
  return p;
}

export default function VerifiedBadge({ tier, userId, size = 15 }: { tier?: Tier; userId?: string | null; size?: number }) {
  const [looked, setLooked] = useState<Tier | false | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!tier && userId) lookupTier(userId).then(t => { if (alive) setLooked(t); });
    return () => { alive = false; };
  }, [tier, userId]);
  const eff: Tier | false | undefined = tier || looked;
  if (!eff) return null;
  const key = eff as string;
  const m = METALS[key] || METALS.business;
  // Rendered a quarter larger than requested so the seal reads clearly at a glance.
  // Render at the size asked for. The old rule multiplied by 1.4 with a 20px
  // floor, so a badge beside 13px text came out at 21px and sat like a sticker
  // rather than punctuation. Instagram and X keep theirs near the cap height of
  // the text; so do we.
  const px = Math.round(size);
  const detailed = px >= 16;
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24" style={{ marginLeft: 3, marginTop: Math.round(px * 0.06) }}>
      <Defs>
        <SvgGradient id={'vb-' + key} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor={m.grad[0]} />
          <Stop offset="0.35" stopColor={m.grad[1]} />
          <Stop offset="0.7" stopColor={m.grad[2]} />
          <Stop offset="1" stopColor={m.grad[3]} />
        </SvgGradient>
      </Defs>
      <Path
        d={SEAL}
        fill={'url(#vb-' + key + ')'}
        stroke={detailed ? 'rgba(255,255,255,0.5)' : undefined}
        strokeWidth={detailed ? 0.4 : undefined}
      />
      {detailed ? (
        <Ellipse cx="9" cy="7" rx="3.4" ry="1.7" fill="rgba(255,255,255,0.38)" transform="rotate(-20 9 7)" />
      ) : null}
      <Path
        d={CHECK}
        fill="none"
        stroke={m.check}
        strokeWidth={px >= 24 ? 2 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
/**
 * Tier identity system - the seal's color extends to the name.
 * TIER_COLORS is the single source; getTierColor maps any tier value;
 * useVerifiedTier looks a user's tier up with its own tiny cache for
 * surfaces that only hold a userId.
 */
export const TIER_COLORS: Record<string, string> = {
  public_figure: '#1D7A38',
  business: '#5B6470',
  official: '#B08D3F',
};

export function getTierColor(tier?: string | null): string | null {
  if (!tier) return null;
  return TIER_COLORS[tier] ?? null;
}

const nameTierCache: Record<string, string | null> = {};

export function useVerifiedTier(userId?: string | null): string | null {
  const [tier, setTier] = React.useState<string | null>(userId ? (nameTierCache[userId] ?? null) : null);
  React.useEffect(() => {
    let alive = true;
    if (!userId) { setTier(null); return; }
    if (userId in nameTierCache) { setTier(nameTierCache[userId]); return; }
    supabase.from('profiles').select('verified_tier, is_verified').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        const t = data ? (data.verified_tier ?? (data.is_verified ? 'business' : null)) : null;
        nameTierCache[userId] = t;
        if (alive) setTier(t);
      });
    return () => { alive = false; };
  }, [userId]);
  return tier;
}
