import { AppShell } from "@/components/AppShell";

export default function TopicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
