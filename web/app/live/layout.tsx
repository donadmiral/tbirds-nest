import { AppShell } from '@/components/AppShell';
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <AppShell wide>{children}</AppShell>;
}
