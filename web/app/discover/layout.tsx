import { AppShell } from "@/components/AppShell";

export default function DiscoverLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail>{children}</AppShell>;
}
