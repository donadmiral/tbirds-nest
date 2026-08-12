import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";

export default async function HomeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username")
    .eq("id", data.user.id)
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <Nav
        name={profile?.full_name ?? "Member"}
        username={profile?.username ?? ""}
      />
      <main className="ml-[260px] flex justify-center px-6 py-8">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
    </div>
  );
}