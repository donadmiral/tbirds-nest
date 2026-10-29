import { AppShell } from "@/components/AppShell";
import { SettingsNavigation } from "@/components/SettingsNavigation";

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell wide><SettingsNavigation />{children}</AppShell>;
}
