"use client";

export function SocialPageFooter({ loading, error, hasMore, loadMore }: {
  loading: boolean; error: string | null; hasMore: boolean; loadMore: () => Promise<void>;
}) {
  if (!hasMore && !error) return null;
  return <div className="flex flex-col items-center gap-2 py-5">
    {error ? <p role="alert" className="text-center text-sm text-danger">{error}</p> : null}
    <button type="button" disabled={loading} onClick={() => void loadMore()}
      className="rounded-full bg-surface px-5 py-2 text-sm font-semibold text-ink hover:bg-surface-elevated disabled:opacity-50">
      {loading ? "Loading…" : error ? "Try again" : "Load more"}
    </button>
  </div>;
}
