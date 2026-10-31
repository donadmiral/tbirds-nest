'use client';

import { createContext, Suspense, use, type ReactNode } from 'react';
import Link from 'next/link';
import AdminIcon from './AdminIcon';
import type { QueueCounts } from '@/lib/queueCountState';

const QueueContext = createContext<Promise<QueueCounts> | null>(null);

/** No browser persistence or shared server cache. Each promise belongs to the
 * staff session that the current server request has just verified. */
export function QueueCountsProvider({ value, children }: { value: Promise<QueueCounts>; children: ReactNode }) {
  return <QueueContext value={value}>{children}</QueueContext>;
}

function Count({ href, fallback }: { href: string; fallback?: number | null }) {
  const pending = use(QueueContext);
  const count = pending ? use(pending).counts[href] : fallback;
  if (count === undefined || count === 0) return null;
  return <span className="pc-rail-count" aria-label={count === null ? 'Count unavailable' : `${count} waiting`}>
    {count === null ? '—' : count > 999 ? '999+' : count}
  </span>;
}

export function QueueBadge({ href, fallback }: { href: string; fallback?: number | null }) {
  if (fallback === undefined && !['/queue', '/reports', '/support'].includes(href)) return null;
  return <Suspense fallback={null}><Count href={href} fallback={fallback} /></Suspense>;
}

function Bell({ href, resolved = false }: { href: string; resolved?: boolean }) {
  const pending = use(QueueContext);
  const state = resolved && pending ? use(pending) : null;
  const alerts = state?.alerts ?? null;
  return <Link href={href}
    aria-label={!state ? 'Work queues' : alerts === null ? 'Work queues; counts unavailable' : `${alerts} items waiting for review`}
    title="Work waiting" className="pc-icon-btn"
    style={{ position: 'relative', width: 38, height: 38, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)' }}>
    <AdminIcon name="bell" size={19} />
    {alerts !== null && alerts > 0 ? <span className="pc-num" style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3.5px', borderRadius: 999, background: 'var(--alert)', color: 'var(--alert-ink)', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg)' }}>{alerts}</span> : null}
  </Link>;
}

export function QueueBell({ href }: { href: string }) {
  return <Suspense fallback={<Bell href={href} />}><Bell href={href} resolved /></Suspense>;
}

function Notice() {
  const pending = use(QueueContext);
  if (!pending || !use(pending).unavailable) return null;
  return <p role="status" className="pc-service-notice">Some queue counts could not be loaded. Open the relevant desk or refresh to try again.</p>;
}

export function QueueCountNotice() {
  return <Suspense fallback={null}><Notice /></Suspense>;
}
