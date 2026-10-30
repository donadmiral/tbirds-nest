/** Actual commerce components with synthetic Auth/database adapters; never an application route. */
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Nav } from '../../components/Nav';
import { TopBar } from '../../components/TopBar';
import { MobileTabBar } from '../../components/MobileTabBar';
import { ThemeProvider } from '../../components/ThemeProvider';
import JobsPage from '../../app/jobs/page';
import JobPage from '../../app/jobs/[id]/page';
import SavedJobsPage from '../../app/jobs/saved/page';
import MyApplicationsPage from '../../app/jobs/applications/page';
import MarketPage from '../../app/market/page';
import ListingPage from '../../app/market/[id]/page';
import OrdersPage from '../../app/market/orders/page';
import SavedListingsPage from '../../app/market/saved/page';
import chrome from '../../components/NavigationChrome.module.css';
import { fixture, OWNER, profiles } from './commerce-backend';
function ActualJob({ id }: { id: string }) {
  const [content, setContent] = useState<ReactNode>(<p role="status">Loading role…</p>);
  useEffect(() => { let active = true; void JobPage({ params: Promise.resolve({ id }) }).then(result => { if (active) setContent(result); }).catch(error => { if (active) setContent(<p role="alert">Fixture could not render the server page: {String(error)}</p>); }); return () => { active = false; }; }, [id]);
  return content;
}
function Fixture() {
  const pathname = usePathname();
  const [owner, setOwner] = useState(fixture.owner());
  useEffect(() => { const change = () => setOwner(fixture.owner()); window.addEventListener('fixture-owner', change); return () => window.removeEventListener('fixture-owner', change); }, []);
  const me = profiles[owner ?? OWNER];
  let content: ReactNode;
  if (pathname === '/jobs') content = <JobsPage />;
  else if (pathname === '/jobs/saved') content = <SavedJobsPage />;
  else if (pathname === '/jobs/applications') content = <MyApplicationsPage />;
  else if (/^\/jobs\/[0-9a-f-]{36}$/.test(pathname)) content = <ActualJob key={owner + pathname} id={pathname.split('/')[2]} />;
  else if (pathname === '/market') content = <MarketPage />;
  else if (pathname === '/market/saved') content = <SavedListingsPage />;
  else if (pathname === '/market/orders') content = <OrdersPage />;
  else if (/^\/market\/[0-9a-f-]{36}$/.test(pathname)) content = <ListingPage key={pathname} />;
  else content = <section className="rounded-xl border border-ink/10 bg-white p-8"><h1 className="text-2xl font-bold">{pathname === '/login' ? 'Sign in' : 'Destination reached'}</h1><p className="mt-3 text-sm text-muted">This fixture verifies navigation to {pathname}. The destination workflow is outside this test.</p><Link href="/jobs" className="mt-5 inline-block underline">Return to Jobs</Link><Link href="/market" className="ml-5 inline-block underline">Return to Market</Link></section>;
  return <ThemeProvider><Nav name={me.full_name} username={me.username} /><div className={chrome.frame}><TopBar name={me.full_name} username={me.username} /><main className={chrome.wideContent}>{content}</main></div><MobileTabBar userId={me.id} name={me.full_name} username={me.username} /><div data-fixture-label style={{ position: 'fixed', right: 8, bottom: 0, zIndex: 200, pointerEvents: 'none', font: '9px Arial', padding: '3px 8px', background: '#ffffffed', color: '#304462', borderRadius: '5px 5px 0 0' }}>LOCAL COMMERCE VERIFICATION · SYNTHETIC RECORDS · NO LIVE ACCOUNT</div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
