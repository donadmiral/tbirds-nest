import { createDiagnosticReporter } from '../../shared/clientDiagnostics';

const report = createDiagnosticReporter(payload => fetch('/api/diagnostics', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
  body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
}));
export function reportClientError(error: unknown, source: 'render' | 'global' | 'promise' = 'render') {
  if (typeof window !== 'undefined') report(error, { source, platform: 'admin', fatal: source === 'render' });
}
