import { AppShell } from "@/components/AppShell";
import { StudioShell } from "@/components/StudioShell";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <AppShell wide><StudioShell>{children}</StudioShell></AppShell>;
}
