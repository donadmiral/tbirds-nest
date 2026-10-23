"use client";
import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientDiagnostics';
export default function ErrorPage({ error, unstable_retry }: { error: Error; unstable_retry: () => void }) {
 useEffect(() => { reportClientError(error); }, [error]);
 return <main className="p-8"><h1>Information unavailable</h1><p>The requested data could not be loaded completely. Retry or contact your administrator.</p><button type="button" onClick={unstable_retry}>Retry</button></main>;
}
