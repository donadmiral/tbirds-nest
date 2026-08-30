import { AppShell } from "@/components/AppShell";

export default function ArchiveLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
