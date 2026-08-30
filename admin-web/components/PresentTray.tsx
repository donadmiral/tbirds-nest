'use client';

/**
 * The collection tray. It only appears once something has been added, sits out
 * of the way at the bottom, and disappears on the builder itself.
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { trayClear, trayRead, TRAY_EVENT, type TrayItem } from '@/lib/share';

export default function PresentTray() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<TrayItem[]>([]);

  useEffect(() => {
    const sync = () => setItems(trayRead());
    sync();
    window.addEventListener(TRAY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TRAY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (items.length === 0 || (pathname || '').startsWith('/present')) return null;

  const pages = Array.from(new Set(items.map(i => i.page)));

  return (
    <div className="pc-no-print" style={{
      position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 60,
      display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px 9px 15px',
      borderRadius: 999, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.12)',
      boxShadow: '0 16px 44px rgba(0,0,0,0.24)', animation: 'pcRise 180ms cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      <span style={{ fontSize: 12.3, fontWeight: 600, color: 'var(--txt)' }}>
        {items.length} {items.length === 1 ? 'item' : 'items'} ready to present
      </span>
      <span style={{ fontSize: 11, color: 'rgba(var(--on),0.38)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {pages.join(' \u00b7 ')}
      </span>
      <button type="button" onClick={() => router.push('/present')}
        style={{ padding: '6.5px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 11.8, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)' }}>
        Open builder
      </button>
      <button type="button" onClick={() => trayClear()} title="Clear the tray" className="pc-icon-btn"
        style={{ width: 28, height: 28, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" style={{ stroke: 'rgba(var(--on),0.42)' }}><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
