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

const SEAL = 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z';
const CHECK = 'M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z';

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
  const px = Math.max(Math.round(size * 1.4), 20);
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24" style={{ marginLeft: 2 }}>
      <Defs>
        <SvgGradient id={'vb-' + key} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor={m.grad[0]} />
          <Stop offset="0.35" stopColor={m.grad[1]} />
          <Stop offset="0.7" stopColor={m.grad[2]} />
          <Stop offset="1" stopColor={m.grad[3]} />
        </SvgGradient>
      </Defs>
      <Path d={SEAL} fill={'url(#vb-' + key + ')'} stroke="rgba(255,255,255,0.5)" strokeWidth={0.4} />
      <Ellipse cx="9" cy="7" rx="3.4" ry="1.7" fill="rgba(255,255,255,0.38)" transform="rotate(-20 9 7)" />
      <Path d={CHECK} fill={m.check} />
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
