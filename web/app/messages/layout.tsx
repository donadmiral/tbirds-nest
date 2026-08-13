import { AppShell } from "@/components/AppShell";

export default function MessagesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}