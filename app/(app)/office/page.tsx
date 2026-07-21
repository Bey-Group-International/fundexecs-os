import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { OfficeShell } from "@/components/office/OfficeShell";
import { loadOfficeLayout } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Virtual Office",
  description:
    "A spatial map of the firm's building — floors, rooms, and interaction zones.",
};

export default async function OfficePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  // The persisted (or default) multi-floor layout renders the map on load.
  const layout = await loadOfficeLayout(ctx.orgId);

  return (
    <div className="mx-auto max-w-6xl">
      <OfficeShell orgId={ctx.orgId} layout={layout} role={ctx.role} />
    </div>
  );
}
