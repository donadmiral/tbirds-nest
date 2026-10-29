import { createDiagnosticReporter } from '../../shared/clientDiagnostics';
import { createClient } from './supabase/client';

const report = createDiagnosticReporter(payload => createClient().rpc('report_client_error', { p_report: payload }));
export function reportClientError(error: unknown, source: 'render' | 'global' | 'promise' | 'feed' = 'render') {
  if (typeof window !== 'undefined') report(error, { source, platform: 'web', fatal: source === 'render' });
}
