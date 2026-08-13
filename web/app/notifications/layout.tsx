import { AppShell } from "@/components/AppShell";

export default function SectionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}