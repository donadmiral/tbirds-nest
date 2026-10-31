"use client";
import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientDiagnostics';
import Link from 'next/link';
import AdminIcon from '@/components/AdminIcon';
export default function ErrorPage({ error, unstable_retry }: { error: Error; unstable_retry: () => void }) {
 useEffect(() => { reportClientError(error); }, [error]);
 return <main className="pc-page-recovery"><section className="pc-recovery-card"><AdminIcon name="warning" size={32} /><h1>Information unavailable</h1><p>The requested data could not be loaded completely. Try again, or return to your workspace to open another desk.</p><div className="pc-recovery-actions"><button type="button" className="pc-button pc-button-primary" onClick={unstable_retry}><AdminIcon name="refresh" size={18} />Try again</button><Link className="pc-button" href="/dashboard"><AdminIcon name="arrowLeft" size={18} />Back to operations</Link></div></section></main>;
}
