import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ThemeProvider } from '../../components/ThemeProvider';
import HiddenWords from '../../app/settings/hidden-words/page';
import MutedWords from '../../app/settings/muted-words/page';
import Standing from '../../app/settings/standing/page';
import Explore from '../../app/explore/page';
import Search from '../../app/search/page';
import Topic from '../../app/topic/[tag]/page';
import MarketNew from '../../app/market/new/page';
import BusinessNew from '../../app/businesses/new/page';
import AdNew from '../../app/ads/new/page';
import Profile from '../../app/settings/profile/page';
import { MarketUnreadDot } from '../../components/MarketUnreadDot';
import { FeaturedChannels, ExploreTopics } from '../../components/DiscoverSections';
import './member-resilience-backend';

const topicParams = Promise.resolve({ tag: 'CoastalStories' });
function App() {
  const path = usePathname();
  const pages: Record<string, React.ReactNode> = {
    '/settings/hidden-words': <HiddenWords />, '/settings/muted-words': <MutedWords />,
    '/settings/standing': <Standing />, '/explore': <Explore />, '/search': <Search />,
    '/topic/CoastalStories': <Topic params={topicParams} />, '/market/new': <MarketNew />,
    '/businesses/new': <BusinessNew />, '/ads/new': <AdNew />, '/settings/profile': <Profile />,
    '/market/unread-fixture': <Link href="/market/messages">Messages <MarketUnreadDot /></Link>,
    '/discover/channels-fixture': <FeaturedChannels />, '/discover/topics-fixture': <ExploreTopics />,
  };
  return <ThemeProvider><Suspense fallback={<p>Loading fixture</p>}><main data-member-resilience>{pages[path] ?? <p role="status">Synthetic destination: {path}</p>}</main></Suspense></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
