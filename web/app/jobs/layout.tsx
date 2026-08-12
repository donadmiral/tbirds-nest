import { AppShell } from "@/components/AppShell";

export default function JobsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}