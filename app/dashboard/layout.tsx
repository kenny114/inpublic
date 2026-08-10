import { DashboardShell } from "@/components/DashboardShell";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAuthenticatedUser())) redirect("/login?next=/dashboard");
  return <DashboardShell>{children}</DashboardShell>;
}
