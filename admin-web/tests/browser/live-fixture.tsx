/** Actual Live desk components. This test entry is never an application route. */
import { createRoot } from 'react-dom/client';
import LiveWorkspace from '@/components/LiveWorkspace';
import SideRail from '@/components/SideRail';
import Workspace from '@/components/Workspace';
import ThemeControls from '@/components/ThemeControls';
import { WorkspaceBreadcrumbs } from '@/components/WorkspaceNavigation';
import { navigationForRole, toolsForRole } from '@/lib/navigation';

const groups = navigationForRole('super_admin');
const destinations = groups.flatMap(group => group.items);
function Fixture() {
  return <div data-pc-staff="live-ui-fixture:super_admin" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)' }}>
    <SideRail groups={groups} active="/live" email="reviewer@example.test" roleLabel="UI verification" tools={toolsForRole('super_admin')} />
    <main style={{ flex: 1, minWidth: 0 }}>
      <header className="pc-topbar" style={{ background: 'var(--topbar)', borderBottom: '1px solid var(--line)' }}><WorkspaceBreadcrumbs items={destinations} active="/live" label="Live operations" /><div className="pc-topbar-actions"><ThemeControls /></div></header>
      <Workspace>
        <div className="pc-page-heading"><div><p className="pc-page-kicker">Community</p><h1 className="pc-page-title">Live operations</h1><p className="pc-page-subtitle">Review broadcasts, clips, production access and moderation decisions.</p></div></div>
        <p className="pc-service-notice">UI verification with controlled data. No production accounts or actions.</p>
        <LiveWorkspace />
      </Workspace>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
