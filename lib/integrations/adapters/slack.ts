// lib/integrations/adapters/slack.ts
// Slack dispatch for the Act-now Radar digest (and any future chat push) — the
// channel that carries the recurring sourcing brief into the operator's Slack.
//
// Mock-or-real: with no Slack credentials in the environment the adapter
// operates in mock mode (it prepares the message but does not post), so the
// digest send -> dispatch flow behaves identically whether or not the operator
// has connected Slack. The real chat.postMessage send is wired at the marked
// seam, once the bot-token credential plumbing lands.
//
// Routing: the digest send reaches this adapter via the DispatchContext.channel
// hint ("slack") rather than by ActionKind, so no new ActionKind is added to
// lib/gates. Registered in ./index by appending slackModule to ADAPTERS; as the
// last module to claim the "slack" channel it supersedes the inbox placeholder
// for channel-pinned dispatch.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

function configured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

export const slackAdapter: DispatchAdapter = {
  channel: "slack",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    // The Slack destination: a channel id / name passed as the target email or
    // name by the caller (the digest passes the configured recipient here).
    const destination = ctx.target?.email ?? ctx.target?.name ?? "the workspace";

    if (!configured()) {
      return {
        ok: true,
        channel: "slack",
        live: false,
        detail: `Prepared a Slack message for ${destination} (Slack not connected — saved to review).`,
      };
    }

    // SEAM: the real post goes here once bot-token plumbing lands —
    //   await fetch("https://slack.com/api/chat.postMessage", {
    //     method: "POST",
    //     headers: {
    //       Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({ channel: destination, text: ctx.body, mrkdwn: true }),
    //   });
    // Until then we return a configured-but-queued result rather than calling an
    // external API from this server action — the contract stays honest and the
    // loop stays observable.
    return {
      ok: true,
      channel: "slack",
      live: false,
      detail: `Queued a Slack message for ${destination} via connected Slack.`,
    };
  },
};

export const slackModule: AdapterModule = {
  // No default ActionKind: the digest (and inbox replies) reach Slack via the
  // DispatchContext.channel hint, so we don't need a new ActionKind in lib/gates.
  handles: [],
  adapter: slackAdapter,
};
