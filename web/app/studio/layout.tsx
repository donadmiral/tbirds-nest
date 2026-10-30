import { AppShell } from "@/components/AppShell";
import { StudioShell } from "@/components/StudioShell";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <AppShell professional><StudioShell>{children}</StudioShell></AppShell>;
}
