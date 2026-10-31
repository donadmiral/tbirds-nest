/** Actual web components with in-memory identities. This is not an app route or Auth bypass. */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Nav } from '../../components/Nav';
import { TopBar } from '../../components/TopBar';
import { MobileTabBar } from '../../components/MobileTabBar';
import { ThemeProvider } from '../../components/ThemeProvider';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import HomeFeed from '../../components/HomeFeed';
import { HomeRail } from '../../components/HomeRail';
import SettingsPage from '../../app/settings/page';
import EditProfilePage from '../../app/settings/profile/page';
import { SettingsNavigation } from '../../components/SettingsNavigation';
import ProfilePage from '../../app/[username]/page';
import { DiscoverFeed } from '../../components/DiscoverFeed';
import CommunitiesPage from '../../app/communities/page';
import CommunityPage from '../../app/communities/[id]/page';
import ChannelsPage from '../../app/channels/page';
import ChannelPage from '../../app/channels/[id]/page';
import { MessagesApp } from '../../components/MessagesApp';
import { MemoryAlbumView } from '../../components/MemoryAlbum';
import { PageHeader } from '../../components/ui';
import chrome from '../../components/NavigationChrome.module.css';
import { fixture, OWNER, posts, profiles } from './social-backend';
function PublicProfile({ username }: { username: string }) {
  const [result, setResult] = useState<ReactNode>(null);
  useEffect(() => { let alive = true; void ProfilePage({ params: Promise.resolve({ username }) }).then(value => { if (alive) setResult(value); }); return () => { alive = false; }; }, [username]);
  return result;
}
function Fixture() {
  const pathname = usePathname();
  const [owner, setOwner] = useState(fixture.owner());
  useEffect(() => { const change = () => setOwner(fixture.owner()); window.addEventListener('fixture-owner', change); return () => window.removeEventListener('fixture-owner', change); }, []);
  const me = profiles[owner ?? OWNER];
  const home = pathname === '/home', settings = pathname === '/settings' || pathname.startsWith('/settings/'), profile = Object.values(profiles).find(value => '/' + value.username === pathname);
  let content: ReactNode;
  if (home) content = <HomeFeed key={owner} seed={{ owner: owner ?? OWNER, rows: posts, mutedWords: [], error: null }} />;
  else if (pathname === '/settings/profile') content = <EditProfilePage />;
  else if (pathname === '/settings') content = <SettingsPage />;
  else if (profile) content = <PublicProfile key={owner + pathname} username={profile.username} />;
  else if (pathname.startsWith('/album/')) content = <MemoryAlbumView ownerId={pathname.slice('/album/'.length)} />;
  else if (pathname === '/messages') content = <MessagesApp />;
  else if (pathname === '/communities') content = <CommunitiesPage />;
  else if (pathname.startsWith('/communities/')) content = <CommunityPage key={owner + pathname} />;
  else if (pathname === '/channels') content = <ChannelsPage />;
  else if (pathname.startsWith('/channels/')) content = <ChannelPage key={owner + pathname} />;
  else if (pathname === '/watch' || pathname === '/discover') content = <><PageHeader title={pathname === '/watch' ? 'Watch' : 'Discover'} subtitle="Explore videos and stories from your circles." /><DiscoverFeed videosOnly={pathname === '/watch'} /></>;
  else content = <section className="rounded-xl border border-ink/10 bg-white p-8"><h1 className="text-2xl font-bold">{pathname === '/login' ? 'Sign in' : 'Destination reached'}</h1><p className="mt-3 text-sm text-muted">This fixture verifies navigation to {pathname}. The destination workflow is outside this test.</p><Link href="/home" className="mt-5 inline-block underline">Return to Home</Link></section>;
  return <ThemeProvider><Nav name={me.full_name} username={me.username} /><div className={chrome.frame}><TopBar name={me.full_name} username={me.username} /><div className={home ? chrome.content : chrome.wideContent}><main className={home ? chrome.mainColumn : ''}>{settings ? <SettingsNavigation /> : null}{content}</main>{home ? <aside className={chrome.rightRail}><div><HomeRail /></div></aside> : null}</div></div><MobileTabBar userId={me.id} name={me.full_name} username={me.username} /><ConnectionBanner /><div data-fixture-label style={{ position: 'fixed', right: 8, bottom: 0, zIndex: 200, pointerEvents: 'none', font: '9px Arial', padding: '3px 8px', background: '#ffffffed', color: '#304462', borderRadius: '5px 5px 0 0' }}>LOCAL UI VERIFICATION · SYNTHETIC RECORDS · NO LIVE ACCOUNT</div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
