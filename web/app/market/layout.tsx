import { AppShell } from "@/components/AppShell";

export default function MarketLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}