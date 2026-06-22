import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getLpReport } from "@/lib/lp-report";
import { LpReport } from "@/components/reports/LpReport";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const report = await getLpReport(ctx.orgId);

  return (
    <div className="mx-auto max-w-4xl">
      <LpReport report={report} />
    </div>
  );
}
