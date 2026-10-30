'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function RefreshDesk() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="pc-button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg>
    {pending ? 'Refreshing…' : 'Refresh'}
  </button>;
}
