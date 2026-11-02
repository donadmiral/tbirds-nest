'use client';
import { Clock3, X } from 'lucide-react';
import { useRecentSearches } from '@/lib/useRecentSearches';
export function RecentSearchList({ query = '', onSelect, id }: { query?: string; onSelect(term: string): void; id?: string }) {
  const history = useRecentSearches();
  const entries = history.entries.filter(entry => entry.term.toLowerCase().includes(query.trim().toLowerCase()));
  return <section id={id} aria-label="Recent searches" className="rounded-xl border border-ink/10 bg-[var(--canvas)] p-3 text-ink shadow-sm">
    <div className="mb-1 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Recent searches</h2>
      {history.entries.length > 0 ? <button type="button" onClick={() => void history.clear()} className="min-h-11 px-2 text-xs font-semibold" aria-label="Clear all recent searches">Clear all</button> : null}
    </div>
    <p className="mb-2 text-xs text-muted">Only you, on this device.</p>
    {!history.ready ? <p className="py-3 text-sm text-muted">Loading recent searches…</p> : entries.length === 0 ? <p className="py-3 text-sm text-muted">{query.trim() ? 'No matching recent searches.' : 'Your searches will appear here.'}</p> : <ul>
      {entries.map(entry => <li key={entry.term} className="flex items-center gap-1 rounded-lg hover:bg-surface">
        <button type="button" data-recent-search className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2 text-left text-sm" onClick={() => { void history.record(entry.term); onSelect(entry.term); }}>
          <Clock3 size={17} className="shrink-0 text-muted" aria-hidden /><span className="truncate">{entry.term}</span>
        </button>
        <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-muted hover:text-ink" aria-label={`Remove ${entry.term} from recent searches`} onClick={() => void history.remove(entry.term)}><X size={17} aria-hidden /></button>
      </li>)}
    </ul>}
  </section>;
}
