import { WorkspacePage } from "@/components/dashboard/WorkspacePage";
import { getDashboardData, getWorkspaceViewModel } from "@/lib/dashboard/data";

export const dynamic = "force-dynamic";

export default async function CapitalDashboardPage() {
  const data = await getDashboardData();
  return <WorkspacePage data={data} view={getWorkspaceViewModel("capital", data)} />;
}
