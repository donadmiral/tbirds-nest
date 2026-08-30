/**
 * The app-wide loading fallback.
 *
 * Next streams this while a route's data resolves. It deliberately mirrors the
 * shape most pages have — a header block and a column of cards — so the layout
 * does not jump when the real content replaces it.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-4">
        <div className="h-[26px] w-[180px] rounded-lg bg-surface" />
        <div className="mt-2 h-[14px] w-[280px] rounded bg-surface/70" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-4 rounded-2xl border border-ink/10 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-surface" />
            <div className="min-w-0 flex-1">
              <div className="h-[13px] w-[140px] rounded bg-surface" />
              <div className="mt-1.5 h-[11px] w-[90px] rounded bg-surface/70" />
            </div>
          </div>
          <div className="mt-3 h-[13px] w-full rounded bg-surface/70" />
          <div className="mt-1.5 h-[13px] w-[75%] rounded bg-surface/70" />
        </div>
      ))}
    </div>
  );
}
