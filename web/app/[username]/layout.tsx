import { AppShell } from "@/components/AppShell";

export default function ProfileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Profiles rendered bare: no sidebar, no top bar, no rail. Landing on one
  // from a post meant leaving the app and having to press back to return.
  return <AppShell rail>{children}</AppShell>;
}
