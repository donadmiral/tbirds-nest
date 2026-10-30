import { AppShell } from '@/components/AppShell';
import { DiscoverRail } from '@/components/HomeRail';

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return <AppShell rail railContent={<DiscoverRail />}>{children}</AppShell>;
}
