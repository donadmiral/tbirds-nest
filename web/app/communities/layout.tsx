import { AppShell } from "@/components/AppShell";

export default function CommunitiesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail>{children}</AppShell>;
}
