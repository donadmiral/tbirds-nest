import { AppShell } from "@/components/AppShell";
import { NotificationSettingsPanel } from "@/components/NotificationsRail";

export default function NotificationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The rail holds the settings shortcuts, which need no page data. The unread
  // summary stays in the page, because its numbers come from the rows the page
  // already loaded and a second count query could disagree with the pills.
  return <AppShell rail railContent={<NotificationSettingsPanel />}>{children}</AppShell>;
}
