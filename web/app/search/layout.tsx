import { AppShell } from "@/components/AppShell";

export default function SearchLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail>{children}</AppShell>;
}
