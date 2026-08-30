import { AppShell } from "@/components/AppShell";
import { DiscoverRail } from "@/components/HomeRail";

export default function DiscoverLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail railContent={<DiscoverRail />}>{children}</AppShell>;
}
