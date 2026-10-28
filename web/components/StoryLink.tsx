'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { StoryViewer } from './StoryViewer';
import type { CatchupUser } from '@/lib/stories';

/** Resolve an exact story under the current account, never an adjacent story. */
export function StoryLink({ storyId }: { storyId: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: 'loading' | 'signin' | 'unavailable' | 'ready'; user?: CatchupUser }>({ status: 'loading' });
  const generation = useRef(0);
  useEffect(() => {
    const client = createClient(); let alive = true, authVersion = 0;
    const load = async (viewer: string | null) => {
      const current = ++generation.current;
      setState({ status: viewer ? 'loading' : 'signin' });
      if (!viewer) return;
      try {
        const { data: allowed, error: denied } = await client.rpc('viewer_can_see_story', { p_story_id: storyId });
        if (denied || allowed !== true) throw new Error('Unavailable');
        const { data: story, error } = await client.from('stories').select('user_id,expires_at,created_at').eq('id', storyId).maybeSingle();
        if (error || !story || !story.expires_at || Date.parse(story.expires_at) <= Date.now()) throw new Error('Unavailable');
        const { data: profile, error: profileError } = await client.from('profiles').select('full_name,username,avatar_url').eq('id', story.user_id).maybeSingle();
        if (profileError || !profile) throw new Error('Unavailable');
        if (alive && generation.current === current) setState({ status: 'ready', user: { ...profile, user_id: story.user_id, story_count: 1, unseen_count: 1, has_unseen: true, latest_story_id: storyId, latest_story_at: story.created_at } });
      } catch { if (alive && generation.current === current) setState({ status: 'unavailable' }); }
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => { authVersion++; void load(session?.user.id ?? null); });
    const initialVersion = authVersion;
    void client.auth.getSession().then(({ data, error }) => { if (alive && authVersion === initialVersion) void load(error ? null : data.session?.user.id ?? null); });
    return () => { alive = false; ++generation.current; subscription.unsubscribe(); };
  }, [storyId]);
  if (state.status === 'ready' && state.user) return <StoryViewer key={storyId} users={[state.user]} startIndex={0} initialStoryId={storyId} onClose={() => router.push('/home')} />;
  return <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center text-ink"><p role="status">{state.status === 'loading' ? 'Opening story…' : state.status === 'signin' ? 'Sign in to view this story.' : 'This story has expired or is not shared with you.'}</p><Link className="rounded-full bg-pearl px-5 py-3 text-sm font-semibold text-on-pearl" href={state.status === 'signin' ? '/login?next=' + encodeURIComponent('/story/' + storyId) : '/home'}>{state.status === 'signin' ? 'Sign in' : 'Go home'}</Link></main>;
}
