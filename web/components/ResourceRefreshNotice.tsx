'use client';

/** A failed refresh must not replace the usable rows or controls below it. */
export function ResourceRefreshNotice({ error, refreshing, retry }: {
  error: string; refreshing: boolean; retry: () => void;
}) {
  if (!error) return null;
  return <p role="status" className="my-3 text-sm text-muted">
    Your last loaded information is still shown. {error}{' '}
    <button type="button" disabled={refreshing} onClick={retry} className="min-h-11 underline disabled:opacity-50">
      {refreshing ? 'Refreshing…' : 'Retry refresh'}
    </button>
  </p>;
}
