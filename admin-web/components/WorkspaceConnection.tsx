'use client';

import { useEffect, useState } from 'react';
import AdminIcon from '@/components/AdminIcon';
import RefreshDesk from '@/components/RefreshDesk';

/** Connectivity feedback never retries an administrative mutation automatically. */
export default function WorkspaceConnection() {
  const [state, setState] = useState<'online' | 'offline' | 'restored'>('online');
  useEffect(() => {
    const offline = () => setState('offline');
    const online = () => setState(previous => previous === 'offline' ? 'restored' : previous);
    if (!navigator.onLine) offline();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, []);
  if (state === 'online') return null;
  return <section className="pc-connection-notice" data-offline={state === 'offline'} role="status" aria-label="Connection status">
    <AdminIcon name={state === 'offline' ? 'warning' : 'check'} size={20} />
    <div><strong>{state === 'offline' ? 'You are offline' : 'Connection restored'}</strong><p>{state === 'offline' ? 'The information on screen may be out of date. Keep your work open and reconnect before saving a change.' : 'Refresh to load the latest information. Any change that failed still needs your review and retry.'}</p></div>
    {state === 'restored' ? <><RefreshDesk /><button type="button" className="pc-button pc-button-square" aria-label="Dismiss connection notice" onClick={() => setState('online')}><AdminIcon name="close" size={18} /></button></> : null}
  </section>;
}
