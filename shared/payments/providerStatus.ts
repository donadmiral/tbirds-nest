/** Safe diagnostics only. None of these values establish payment finality. */
export type ProviderIssue = {
  code: string;
  userMessage: string;
  operatorMessage: string;
};

const scopes: Record<string, string> = {
  links: 'account linking', refunds: 'refunds', payouts: 'payouts',
  payments: 'payments', balance: 'balance and connection reads',
};

export function providerIssue(value: unknown): ProviderIssue | null {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const candidates = [body.code, body.error, typeof value === 'string' ? value : null];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const [code, suffix, extra] = candidate.split(':');
    if (extra !== undefined) continue;
    const scope = typeof body.capability === 'string' ? body.capability : suffix;
    if (code === 'KEY_PERMISSION_DENIED') {
      const operation = scope && Object.prototype.hasOwnProperty.call(scopes, scope) ? scopes[scope] : 'this operation';
      return {
        code,
        userMessage: scope === 'links'
          ? 'Connecting or disconnecting IntoBank is temporarily unavailable. Please contact support.'
          : 'IntoBank has not enabled this operation for Platinum Circles. Please contact support.',
        operatorMessage: `The provider key does not permit ${operation}. Verify the key environment and approve the required scope in IntoBank. A scope grant does not approve a bank funding source or enable live payments.`,
      };
    }
    if (suffix !== undefined) continue;
    if (code === 'CRISP_NOT_CONFIGURED' || code === 'CRISP_UNAVAILABLE') return {
      code,
      userMessage: 'The IntoBank connection is not set up for this app environment. Please contact support.',
      operatorMessage: 'Configure CRISP_API_URL and CRISP_API_KEY as server-side secrets in this Supabase project. Verify the intended test or live environment and approved permissions; never expose the provider key in public app variables.',
    };
    if (code === 'BANK_PAYMENT_REQUIRED') return {
      code,
      userMessage: 'This payment is unavailable until the bank funding connection is approved. Please contact support.',
      operatorMessage: 'IntoBank requires an approved bank funding connection and the appropriate payment mandate. Do not retry through a legacy wallet or treat the API key as funding consent.',
    };
    if (code === 'LIVE_BANK_INTEGRATION_NOT_APPROVED') return {
      code,
      userMessage: 'IntoBank has not enabled live payments yet. Connecting an account does not enable live payments.',
      operatorMessage: 'The provider has not approved live bank payments. Keep test and live records separate; a working test key is not evidence of live capability.',
    };
    if (code === 'PAYOUT_PROVIDER_UNCONFIRMED' || code === 'PAYMENT_OUTCOME_UNCONFIRMED') return {
      code,
      userMessage: 'The payment outcome is still being confirmed. Check its status before trying again.',
      operatorMessage: 'The provider has not confirmed the outcome. Reconcile the existing reference; do not create a replacement payment or release its reservation.',
    };
  }
  return null;
}

export function bridgeConnectionStatus(value: unknown, now = Date.now()) {
  const run = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const checked = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
  const step = Array.isArray(run.steps) ? run.steps.find(item => item?.name === 'payments_bridge') : null;
  if (!Number.isFinite(checked) || checked > now + 60000 || !step || typeof step.ok !== 'boolean') {
    return { state: 'unknown', label: 'No verified connection check', checkedAt: null, detail: 'Connection health is not available. This does not establish whether payments are enabled.' };
  }
  const checkedAt = new Date(checked).toISOString();
  if (now - checked > 30 * 60 * 1000) {
    return { state: 'stale', label: 'Connection check is out of date', checkedAt, detail: 'Refresh the scheduled health check before relying on its result.' };
  }
  if (step.ok) return {
    state: 'passed', label: 'Last connection check passed', checkedAt,
    detail: 'The status endpoint responded. This check does not verify the key environment, linking or payout permissions, bank consent, or live settlement.',
  };
  const detail = typeof step.detail === 'string' ? step.detail : '';
  const code = /^(?:status \d{3}: )?([A-Z_]+)(?:: |$)/.exec(detail)?.[1];
  return {
    state: 'failed', label: 'Last connection check failed', checkedAt,
    detail: providerIssue(code)?.operatorMessage || 'Investigate the bridge and provider configuration. A failed check must not be displayed as an unlinked account.',
  };
}
