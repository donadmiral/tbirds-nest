import { AppShell } from "@/components/AppShell";
export default function HomeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell rail>{children}</AppShell>;
}