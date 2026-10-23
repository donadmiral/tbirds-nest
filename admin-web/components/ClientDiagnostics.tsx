"use client";
import { useEffect } from 'react';
import { reportClientError } from '@/lib/clientDiagnostics';
export function ClientDiagnostics() {
  useEffect(() => {
    const error = (event: ErrorEvent) => reportClientError(event.error, 'global');
    const rejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, 'promise');
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); };
  }, []);
  return null;
}
