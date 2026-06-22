import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard/data";
import { AppShell } from "@/components/dashboard/AppShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const data = await getDashboardData();

  return <AppShell data={data}>{children}</AppShell>;
}
