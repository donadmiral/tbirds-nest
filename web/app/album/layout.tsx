import { AppShell } from "@/components/AppShell";

export default function AlbumLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
