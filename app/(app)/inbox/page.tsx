import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getInbox } from "@/lib/inbox";
import { InboxView } from "@/components/inbox/InboxView";
import { getInboxThreads } from "@/lib/inbox/data";
import {
  buildDigest,
  priorityBucket,
  suggestedAction,
  type DigestThread,
} from "@/lib/inbox/intelligence";
import { channelMeta } from "@/lib/inbox/channels";
import { tierForAction, type GateTier } from "@/lib/gates";
import { seedInboxDemo, clearInbox } from "./actions";
import { InboxBoard, type InboxCardData } from "./InboxBoard";

export const dynamic = "force-dynamic";

// Standardized section heading — a short gold tick before a mono-cased label.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
      <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
      {children}
    </h2>
  );
}

export default async function InboxPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  // Two lanes, one inbox: the action queue ("needs you" — approvals, overdue
  // diligence, IC-ready deals, open risks) and the unified communications
  // stream (booking / messaging / video), each fetched in parallel.
  const [inbox, views] = await Promise.all([
    getInbox(ctx.orgId),
    getInboxThreads(supabase),
  ]);

  // Prepare every comms display field on the server so the client board never
  // imports the intelligence module (and its AI SDK) into the browser bundle.
  const cards: InboxCardData[] = views.map(({ thread, context }) => {
    const meta = channelMeta(thread.channel);
    const move = suggestedAction(thread);
    return {
      id: thread.id,
      channel: thread.channel,
      channelLabel: meta.label,
      channelIcon: meta.icon,
      category: thread.category,
      subject: thread.subject,
      counterparty: thread.counterparty_name ?? thread.counterparty_email ?? "Unknown",
      summary: thread.ai_summary ?? thread.preview ?? "",
      intent: thread.intent,
      priority: thread.priority,
      bucket: priorityBucket(thread.priority),
      unread: thread.unread,
      status: thread.status,
      meetingAt: thread.meeting_at,
      meetingUrl: thread.meeting_url,
      context,
      suggested: move
        ? { action: move.action, label: move.label, tier: tierForAction(move.action) as GateTier }
        : null,
      canShare: Boolean(context),
      shareTier: tierForAction("share_materials") as GateTier,
    };
  });

  const digest = buildDigest(
    views.map(({ thread }): DigestThread => ({
      category: thread.category,
      status: thread.status,
      unread: thread.unread,
      priority: thread.priority,
    })),
  );

  return (
    <div className="fx-ambient mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            <span aria-hidden className="h-4 w-1 rounded-full bg-gradient-to-b from-gold-300 to-gold-500" />
            Unified Inbox
          </span>
          <h1 className="mt-2.5 font-display text-3xl font-semibold tracking-tight text-fg-primary sm:text-[2rem]">
            One inbox, triaged
          </h1>
          <p className="mt-1.5 text-sm text-fg-secondary">
            What needs you — and every booking, message, and video thread — in one
            ranked place. {digest.headline}
          </p>
        </div>
      </header>

      {/* Lane 1 — the action queue: what the operator must act on. */}
      <section className="mb-8">
        <SectionHeading>Needs you</SectionHeading>
        <InboxView inbox={inbox} />
      </section>

      {/* Lane 2 — unified communications: booking, messaging, video. */}
      <section>
        <SectionHeading>Communications</SectionHeading>
        <InboxBoard cards={cards} />
      </section>
    </div>
  );
}
