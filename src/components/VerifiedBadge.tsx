/**
 * VerifiedBadge - the metals of Platinum Circles verification, cut in the
 * classic scalloped seal. Green: public figures and renowned educators.
 * Space grey: verified businesses. Platinum with a single halo ring:
 * officials, government, and the founder.
 *
 * Two ways to use it:
 *   <VerifiedBadge tier={tier} />          when the screen already has the tier
 *   <VerifiedBadge userId={profileId} />   anywhere else - it looks the tier up
 *                                          itself, cached per user, and renders
 *                                          nothing for unverified accounts.
 * One component, one metal table: identical colors on every screen.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
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

// Session cache: one lookup per user, shared by every badge on screen.
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
  const halo = eff === 'official';
  return (
    <View style={{ width: size + (halo ? 7 : 0), height: size + (halo ? 7 : 0), alignItems: 'center', justifyContent: 'center', marginLeft: 3 }}>
      {halo ? (
        <View style={{ position: 'absolute', width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, borderWidth: 1.8, borderColor: '#C9BFB0' }} />
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 24 24">
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
    </View>
  );
}