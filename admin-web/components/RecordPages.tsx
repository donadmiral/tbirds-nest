import Link from 'next/link';
import { formatCount, recordPageHref, type recordPage } from '@/lib/deskReporting';

export default function RecordPages({ path, range, loaded, label, query = '' }: {
  path: string; range: ReturnType<typeof recordPage>; loaded: number; label: string; query?: string;
}) {
  return <nav aria-label={label + ' pages'} className="my-4 flex min-w-0 flex-wrap items-center gap-3 text-sm">
    <span className="mr-auto min-w-0">
      {loaded ? `${formatCount(range.from + 1)}–${formatCount(range.from + loaded)} of ${formatCount(range.total)} ${label.toLowerCase()}` : `No ${label.toLowerCase()} on this page`}
      {' · '}Page {formatCount(range.page)} of {formatCount(range.pages)}
    </span>
    {range.page > 1 ? <>
      <Link href={recordPageHref(path, 1, query)} prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border px-3">First page</Link>
      <Link href={recordPageHref(path, range.page - 1, query)} prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border px-3">Previous page</Link>
    </> : null}
    {range.page < range.pages ? <Link href={recordPageHref(path, range.page + 1, query)} prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border px-3">Next page</Link> : null}
  </nav>;
}
