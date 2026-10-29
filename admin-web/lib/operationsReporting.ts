/** Deployment identity must never be inferred from a production-mode build. */
export function deploymentEnvironment(environment: string | undefined, nodeEnvironment?: string) {
  if (environment === 'production') return { label: 'Production', tone: 'ok' } as const;
  if (environment === 'preview') return { label: 'Preview', tone: 'warn' } as const;
  if (environment === 'development' || nodeEnvironment === 'development') return { label: 'Development', tone: 'info' } as const;
  if (nodeEnvironment === 'test') return { label: 'Test', tone: 'info' } as const;
  return { label: 'Environment unverified', tone: 'warn' } as const;
}

/** A capped or failed query cannot support a complete financial total. */
export function completeRecordedPayments(result: {
  data: { paid_amount: number | string | null; currency: string | null }[] | null;
  count: number | null;
  error: unknown;
}): { currency: string; amount: number }[] | null {
  if (result.error || !result.data || !Number.isSafeInteger(result.count) || result.data.length !== result.count) return null;
  const totals = new Map<string, number>();
  for (const row of result.data) {
    // Stored campaign payments use two decimal places. Sum integer minor units
    // so repeated fractional payments cannot accumulate floating-point errors.
    if (row.paid_amount === null) return null;
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(String(row.paid_amount));
    if (!match) return null;
    const amount = Number(match[1] + (match[2] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(amount)) return null;
    const currency = row.currency?.trim().toUpperCase() || 'Unknown currency';
    const total = (totals.get(currency) || 0) + amount;
    if (!Number.isSafeInteger(total)) return null;
    totals.set(currency, total);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount / 100 }));
}
