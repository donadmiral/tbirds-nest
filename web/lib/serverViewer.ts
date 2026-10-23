import { cache } from 'react';
import { createClient } from './supabase/server';
import { withTimeout } from './withTimeout';

/** React.cache deduplicates identity verification within one server render only. */
export const getServerViewer = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await withTimeout(supabase.auth.getUser());
  if (error && error.name !== 'AuthSessionMissingError' && error.status !== 401 && error.status !== 403) throw new Error('Sign-in could not be checked. Please try again.');
  return { supabase, user: data.user };
});
