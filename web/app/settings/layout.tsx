import { AppShell } from "@/components/AppShell";

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell wide>{children}</AppShell>;
}
