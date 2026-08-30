import { AppShell } from "@/components/AppShell";
import { HomeRail } from "@/components/HomeRail";

export default function HomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail railContent={<HomeRail />}>{children}</AppShell>;
}
