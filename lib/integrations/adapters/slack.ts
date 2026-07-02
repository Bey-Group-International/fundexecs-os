// lib/integrations/adapters/slack.ts
// Internal notification dispatch — delivers digest posts and step notifications
// to the unified inbox (in-platform). No external Slack API dependency.
//
// When ctx.supabase is available the adapter writes an inbox_threads +
// inbox_messages row so the message surfaces immediately in the inbox UI.
// The dispatch_log (lib/integrations/log.ts) captures every dispatch regardless,
// so nothing is lost even if the DB write fails.
//
// Routing: the digest send reaches this adapter via the DispatchContext.channel
// hint ("slack") rather than by ActionKind. Registered last in ./index so it
// supersedes the inbox placeholder for channel-pinned dispatch.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

export const slackAdapter: DispatchAdapter = {
  channel: "slack",
  // Always available — no external credentials required.
  isConfigured: () => true,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const destination = ctx.target?.email ?? ctx.target?.name ?? "the workspace";
    let persisted = false;

    // Write to internal inbox when a Supabase client is threaded through.
    if (ctx.supabase) {
      try {
        const threadId = `slack-${ctx.orgId}-${crypto.randomUUID()}`;
        await (ctx.supabase.from("inbox_threads") as ReturnType<typeof ctx.supabase.from>).upsert(
          {
            id: threadId,
            org_id: ctx.orgId,
            channel: "slack",
            subject: ctx.subject ?? "Internal notification",
            status: "unread",
          },
          { onConflict: "id", ignoreDuplicates: false },
        );
        await (ctx.supabase.from("inbox_messages") as ReturnType<typeof ctx.supabase.from>).insert({
          thread_id: threadId,
          org_id: ctx.orgId,
          channel: "slack",
          direction: "inbound",
          body: ctx.body ?? ctx.subject ?? "",
        });
        persisted = true;
      } catch {
        // Non-fatal — dispatch_log still captures the event.
      }
    }

    return {
      ok: true,
      channel: "slack",
      live: persisted,
      detail: persisted
        ? `Notification delivered to internal inbox for ${destination}.`
        : `Notification logged for ${destination} — internal inbox unavailable.`,
    };
  },
};

export const slackModule: AdapterModule = {
  // No default ActionKind: the digest (and inbox replies) reach Slack via the
  // DispatchContext.channel hint, so we don't need a new ActionKind in lib/gates.
  handles: [],
  adapter: slackAdapter,
};
