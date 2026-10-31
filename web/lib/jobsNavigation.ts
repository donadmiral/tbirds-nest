import { getNavigationStore } from './navigationCache';
import type { JobRow } from './jobs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withTimeout } from './withTimeout';

export const JOBS_NAVIGATION_KEY = 'jobs:discover';
export const JOB_SAVE_CHANGED = 'pc-job-save-changed';
export type JobSaveChange = { ownerId: string; scope: string; jobId: string; saved: boolean };
export type JobsNavigationMemory = {
  jobs: JobRow[]; loaded: boolean; savedIds: string[]; myCity: string;
  scope: 'all' | 'primary' | 'global'; category: string;
  sort: 'recent' | 'popular' | 'salary' | 'urgent'; search: string; scrollTop: number;
};

/** Route changes may finish a save; an account/session change must cancel it. */
export async function saveJobForSession(client: SupabaseClient, ownerId: string, jobId: string, saved: boolean, canDispatch: () => boolean): Promise<void> {
  const store = getNavigationStore(), started = store.getSnapshot(), controller = new AbortController();
  let changed = false, scope = started.scope;
  const current = () => {
    const session = store.getSnapshot();
    return !changed && !controller.signal.aborted && (scope ? session.scope === scope : !session.changed);
  };
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user.id !== ownerId || !current()) { changed = true; controller.abort(); }
  });
  try {
    const { data, error } = await withTimeout(client.auth.getSession());
    const session = data.session, navigation = store.getSnapshot();
    if (error || !session?.access_token || session.user.id !== ownerId || navigation.owner !== ownerId || !navigation.scope || !current() || !canDispatch()) throw new Error('The job save session changed. Try again.');
    scope = navigation.scope;
    const query = saved
      ? client.from('job_saves').insert({ user_id: ownerId, job_id: jobId })
      : client.from('job_saves').delete().eq('user_id', ownerId).eq('job_id', jobId);
    const { error: failure } = await withTimeout(query.setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(controller.signal));
    if (failure && !(saved && failure.code === '23505')) throw failure;
    if (!current()) throw new Error('The job save session changed. Try again.');
    rememberJobSave(ownerId, scope, jobId, saved);
  } finally { subscription.unsubscribe(); controller.abort(); }
}

/** A save on the shortlist/detail route must update the remembered Discover state. */
export function rememberJobSave(owner: string, expectedScope: string | null, jobId: string, saved: boolean) {
  const store = getNavigationStore(), session = store.getSnapshot();
  if (!expectedScope || session.owner !== owner || session.scope !== expectedScope) return;
  const memory = store.cache.read<JobsNavigationMemory>(expectedScope, JOBS_NAVIGATION_KEY);
  if (memory) {
    const ids = new Set(memory.savedIds);
    if (saved) ids.add(jobId); else ids.delete(jobId);
    store.cache.save(expectedScope, JOBS_NAVIGATION_KEY, { ...memory, savedIds: [...ids] });
  }
  // A replacement Jobs instance may already be refreshing when a card from
  // the previous instance confirms. Update its mutation fence as well.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<JobSaveChange>(JOB_SAVE_CHANGED, { detail: { ownerId: owner, scope: expectedScope, jobId, saved } }));
}
