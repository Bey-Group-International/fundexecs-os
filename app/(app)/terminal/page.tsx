import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { TERMINAL_ENABLED } from "@/lib/terminal/config";
import { loadTerminalWorkspace } from "@/lib/terminal/store";
import { defaultLayoutForPreset, serializeLayout } from "@/lib/terminal/layout";
import { TerminalShell } from "@/components/terminal/TerminalShell";
import { recordCommandRun, persistLayout } from "./actions";

export const metadata: Metadata = {
  title: "Terminal · FundExecs OS",
  description: "The Private Markets Intelligence Terminal — a configurable multi-pane operating environment driven by the FundExecs command language.",
};

export const dynamic = "force-dynamic";

// The Private Markets Intelligence Terminal (Release 1 — the shell). Multi-pane
// workspace + command bar that parses → previews the plan → dispatches through the
// unified action contract, writing command_runs. Ships behind TERMINAL_ENABLED; a
// user who reaches the route with the flag off is redirected home (it is not yet
// linked in the nav).
export default async function TerminalPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");
  if (!TERMINAL_ENABLED) redirect("/home");

  const saved = await loadTerminalWorkspace(ctx.orgId, ctx.userId);
  const initialLayout = serializeLayout(
    saved && saved.layout.root ? saved.layout : defaultLayoutForPreset("executive_brief"),
  );

  return (
    <TerminalShell
      initialLayout={initialLayout}
      recordCommandRunAction={recordCommandRun}
      persistLayoutAction={persistLayout}
    />
  );
}
