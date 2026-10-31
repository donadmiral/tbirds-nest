'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import AdminIcon from '@/components/AdminIcon';

export default function RefreshDesk() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="pc-button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
    <AdminIcon name="refresh" size={17} />
    {pending ? 'Refreshing…' : 'Refresh'}
  </button>;
}
