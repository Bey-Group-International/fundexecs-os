import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getInbox } from "@/lib/inbox";
import { InboxView } from "@/components/inbox/InboxView";
import { getInboxThreads, autoUnsnoozeExpired } from "@/lib/inbox/data";
import {
  buildDigest,
  priorityBucket,
  inboxTab,
  quickReplies,
  suggestedAction,
  type DigestThread,
} from "@/lib/inbox/intelligence";
import { channelMeta, INBOX_CHANNELS } from "@/lib/inbox/channels";
import type { InboxChannel } from "@/lib/supabase/database.types";
import { UNASSIGNED, type InboxThreadFilters } from "@/lib/inbox/data";
import { orgConnectedChannels } from "@/lib/integrations/gateway";
import { tierForAction, type GateTier } from "@/lib/gates";
import { markOpenThreadsRead, getOrgTeammates } from "./actions";
import { InboxBoard, type InboxCardData } from "./InboxBoard";
import { InboxReadMarker } from "./InboxReadMarker";
import { InboxLive } from "./InboxLive";
import { InboxSearch } from "./InboxSearch";

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

export default async function InboxPage(
  props: {
    searchParams: Promise<{ q?: string; channel?: string; unread?: string; assigned?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  // Parse the search/filter bar's URL params into DB-side filters. Channel is
  // validated against the catalog so an unknown value is ignored rather than
  // silently returning nothing. The assignee filter accepts "me", "unassigned",
  // or a teammate's principal id.
  const channelParam = searchParams.channel;
  const assignedParam = searchParams.assigned;
  const assignedTo =
    assignedParam === "me"
      ? ctx.userId
      : assignedParam === UNASSIGNED
        ? UNASSIGNED
        : assignedParam || undefined;
  const filters: InboxThreadFilters = {
    q: searchParams.q?.trim() || undefined,
    channel:
      channelParam && channelParam in INBOX_CHANNELS ? (channelParam as InboxChannel) : undefined,
    unreadOnly: searchParams.unread === "1",
    assignedTo,
  };
  const hasFilters = Boolean(filters.q || filters.channel || filters.unreadOnly || filters.assignedTo);

  const supabase = await createServerClient();
  // Wake any snoozed threads whose time has passed, so they reappear on this
  // render rather than the next one.
  await autoUnsnoozeExpired(supabase, ctx.orgId);
  // Two lanes, one inbox: the action queue ("needs you" — approvals, overdue
  // diligence, IC-ready deals, open risks) and the unified communications
  // stream (booking / messaging / video), plus the org's teammates for the
  // assignee picker — all fetched in parallel.
  const [inbox, views, teammates, connectedChannels] = await Promise.all([
    getInbox(ctx.orgId),
    getInboxThreads(supabase, filters),
    getOrgTeammates(),
    orgConnectedChannels(supabase, ctx.orgId),
  ]);

  // Prepare every comms display field on the server so the client board never
  // imports the intelligence module (and its AI SDK) into the browser bundle.
  const cards: InboxCardData[] = views.map(({ thread, context, assignee }) => {
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
      // Focused / Other split — high-signal vs ambient, from the same triage
      // score plus unread / linked-context signals (resolved on the server so
      // the client board never imports the intelligence module's AI SDK).
      tab: inboxTab({
        priority: thread.priority,
        unread: thread.unread,
        hasContext: Boolean(context),
      }),
      unread: thread.unread,
      status: thread.status,
      snoozedUntil: thread.snoozed_until,
      meetingAt: thread.meeting_at,
      meetingUrl: thread.meeting_url,
      context,
      assignee,
      // Whether this org has connected the thread's channel (gateway-resolved).
      // Drives the composer's "connect to send" hint and matches how dispatch
      // decides prepared (draft) vs queued (route through the connected provider).
      connected: connectedChannels.has(thread.channel),
      suggested: move
        ? { action: move.action, label: move.label, tier: tierForAction(move.action) as GateTier }
        : null,
      // One-tap reply openers for the composer — pure/instant, computed here so
      // the client never imports the intelligence module.
      quickReplies: quickReplies({ category: thread.category, meetingAt: thread.meeting_at }),
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
      {/* Mark all visible open threads as read when the operator opens the inbox. */}
      <InboxReadMarker action={markOpenThreadsRead} />
      {/* Live updates: refresh as threads/messages arrive or change. */}
      <InboxLive orgId={ctx.orgId} />
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
        <InboxSearch teammates={teammates} />
        {cards.length === 0 && hasFilters ? (
          <div className="fx-card p-8 text-center">
            <p className="text-sm text-fg-muted">No threads match your search. Clear the filters to see the full inbox.</p>
          </div>
        ) : (
          <InboxBoard cards={cards} teammates={teammates} />
        )}
      </section>
    </div>
  );
}
