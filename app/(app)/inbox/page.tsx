import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { getInbox } from "@/lib/inbox";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const inbox = await getInbox(ctx.orgId);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Inbox
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Things that need you
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          One place for what the operator must act on — workflows awaiting
          approval, overdue diligence, deals ready for IC, and open critical
          risks. Every item links straight to where the work gets done.
        </p>
      </header>

      <InboxView inbox={inbox} />
    </div>
  );
}
