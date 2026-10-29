"use client";
import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientDiagnostics';
export default function GlobalError({ error, unstable_retry }: { error: Error; unstable_retry: () => void }) {
  useEffect(() => { reportClientError(error); }, [error]);
  return <html lang="en"><body style={{ margin: 0, background: '#FAFAF9', color: '#17181C', fontFamily: 'system-ui, sans-serif' }}>
    <main style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
      <h1>Something went wrong</h1><p>The page could not load. Please try again.</p>
      <button type="button" onClick={unstable_retry} style={{ padding: '12px 20px', borderRadius: 12, background: '#17181C', color: '#FFFFFF', cursor: 'pointer' }}>Try again</button>
    </main>
  </body></html>;
}
