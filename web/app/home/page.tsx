import { redirect } from 'next/navigation';
import HomeFeed from '@/components/HomeFeed';
import { getServerViewer } from '@/lib/serverViewer';
import type { FeedSeed } from '@/lib/homeFeedController';

export default async function HomePage() {
  const { user } = await getServerViewer();
  if (!user) redirect('/login');
  // Mount the account-scoped cache as soon as authentication is verified.
  // Feed, preference and media requests continue independently in HomeFeed.
  const seed: FeedSeed = {
    owner: user.id, rows: [], mutedWords: [], error: null,
    pending: true, preferencesReady: false,
  };
  return <HomeFeed key={user.id} seed={seed} />;
}
