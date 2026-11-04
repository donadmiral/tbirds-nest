import Link from 'next/link';
import { LiveIcon } from './LiveIcon';
export function LiveEntry({ active = false }: { active?: boolean }) {
  return <Link href="/live" aria-label="Live streams" title="Live streams" aria-current={active ? 'page' : undefined} data-live-entry
    className={'relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 ' + (active ? 'bg-surface' : '')}>
    <LiveIcon size={23} />
    {active ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-pearl" /> : null}
  </Link>;
}
