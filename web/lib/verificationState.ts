"use client";
import { createClient } from '@/lib/supabase/client';
import { createVerificationCache } from '../../shared/verificationCache';

export const verificationCache = createVerificationCache(async ids => {
  const { data, error } = await createClient().from('profiles').select('id,is_verified,verified_tier').in('id', ids);
  if (error) throw error;
  return data ?? [];
});
