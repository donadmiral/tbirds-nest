"use client";
import { useEffect, useState } from 'react';
import { verificationCache } from './verificationState';
type Tier = { verified: boolean; tier: string | null };
export function lookupTier(id: string, cb: (value: Tier) => void) {
  return verificationCache.subscribe(id, tier => cb({verified: !!tier, tier}));
}
export function useTier(userId?: string | null): Tier | null {
  const [value, setValue] = useState<{id:string; result:Tier} | null>(null);
  useEffect(() => {
    if (!userId) return;
    return lookupTier(userId, result => setValue({id:userId, result}));
  }, [userId]);
  return userId && value?.id === userId ? value.result : null;
}
