import { redirect } from 'next/navigation';
import HomeFeed from '@/components/HomeFeed';
import { getServerViewer } from '@/lib/serverViewer';
import { loadInitialFeed } from '@/lib/initialFeed';

export default async function HomePage() {
  const { supabase, user } = await getServerViewer();
  if (!user) redirect('/login');
  const seed = await loadInitialFeed(supabase, user.id);
  return <HomeFeed key={user.id} seed={seed} />;
}
