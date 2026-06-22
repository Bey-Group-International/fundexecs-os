import { WorkspacePage } from "@/components/dashboard/WorkspacePage";
import { getDashboardData, getWorkspaceViewModel } from "@/lib/dashboard/data";

export const dynamic = "force-dynamic";

export default async function MarketingDashboardPage() {
  const data = await getDashboardData();
  return <WorkspacePage data={data} view={getWorkspaceViewModel("marketing", data)} />;
}
