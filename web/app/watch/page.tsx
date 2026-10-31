import Link from 'next/link';
import { Plus, Video } from 'lucide-react';
import { DiscoverFeed } from '@/components/DiscoverFeed';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Watch' };

export default function WatchPage() {
  return <section>
    <PageHeader title="Watch" subtitle="Films, highlights and stories from your circles.">
      <Link href="/home?compose=video" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink/15 bg-white px-4 text-xs font-semibold text-ink"><Plus size={17} aria-hidden /><span>Share a video</span></Link>
    </PageHeader>
    <div className="mb-5 flex items-center gap-2 text-xs text-muted"><Video size={16} aria-hidden /><span>Videos you can watch, save and discuss</span></div>
    <DiscoverFeed videosOnly />
  </section>;
}
