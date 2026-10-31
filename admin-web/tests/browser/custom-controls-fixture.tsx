import { createRoot } from 'react-dom/client';
import OperationsPanel from '../../app/music/OperationsPanel';
import RecoveryForms from '../../app/reset-password/RecoveryForms';
import ReviewForm from '../../app/payments/creators/ReviewForm';
import './custom-controls-actions';

const query = new URLSearchParams(location.search);
const area = query.get('area') || 'operations';
window.__CUSTOM_STATE__ = { scenario: query.get('scenario') || 'ok', events: [], refreshes: 0 };
window.addEventListener('fixture:refresh', () => { window.__CUSTOM_STATE__.refreshes++; });
const providers = query.get('providers') === 'none' ? [] : [
  { id: 'awaiting', name: 'Awaiting provider', status: 'awaiting_license' },
  { id: 'licensed', name: 'Licensed provider', status: 'licensed' },
  { id: 'blocked', name: 'Blocked provider', status: 'blocked' },
];
const operations = { version: Number(query.get('version') || 2), catalogEnabled: false, catalogueTotal: 0, catalogueService: { ingestionEnabled: false, playbackEnabled: false },
  maintenance: { enabled: false, lastSeenAt: null }, cleanup: { pending: 0, review: 0, complete: 0 }, catalogue: [] };
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 960, margin: '0 auto', padding: 16, display: 'grid', gap: 20 }}>
  <h1>Actual admin controls · synthetic actions</h1>
  {area === 'operations' ? <OperationsPanel operations={query.get('version') === 'missing' ? null : operations} providers={providers} />
    : area === 'recovery' ? <RecoveryForms mode={(query.get('mode') || 'request') as 'request' | 'mfa' | 'password'} factors={[
      { id: '50000000-0000-4000-8000-000000000005', name: 'First authenticator' }, { id: '40000000-0000-4000-8000-000000000004', name: 'Second authenticator' },
    ]} />
      : <ReviewForm userId="40000000-0000-4000-8000-000000000004" updatedAt="2026-10-31T12:00:00.123456Z" status={query.get('status') || 'applied'} commandKey="30000000-0000-4000-8000-000000000003" />}
</main>);
