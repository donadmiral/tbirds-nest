import { AppShell } from "@/components/AppShell";

export default function AdsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail>{children}</AppShell>;
}
