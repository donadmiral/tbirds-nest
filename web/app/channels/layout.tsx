import { AppShell } from "@/components/AppShell";

export default function ChannelsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell wide>{children}</AppShell>;
}
