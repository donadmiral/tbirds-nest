import { AppShell } from "@/components/AppShell";

export default function BusinessesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
