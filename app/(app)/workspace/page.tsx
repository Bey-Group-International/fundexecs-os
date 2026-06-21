import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { copilotLive } from "@/lib/claude";
import Copilot from "@/components/Copilot";
import { WorkspaceOperatingSystem } from "@/components/workspace/WorkspaceOperatingSystem";

export const dynamic = "force-dynamic";

// The launcher — a fresh Earn conversation. Recent sessions live in the left
// sidebar (the conversation list), so this is just an empty chat: sending a
// prompt opens a session and the conversation continues at /session/<id>.
export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-7xl">
      <WorkspaceOperatingSystem />
      <Copilot orgId={ctx.orgId} live={copilotLive()} bundles={[]} />
    </div>
  );
}
