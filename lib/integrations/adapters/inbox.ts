// lib/integrations/adapters/inbox.ts
// The booking / messaging / video channels the Unified Inbox adds to the
// dispatch layer: Slack (chat), Calendly + Google Calendar (booking), and Zoom +
// Google Meet (video). Each follows the same mock-or-real discipline as Gmail
// and Docusign — with no provider credentials present, the adapter prepares a
// well-formed result (and a plausible meeting/booking link) rather than failing,
// so the gate -> dispatch -> Outbox loop is fully observable before any OAuth
// plumbing lands.
//
// Two routing modes share these adapters. ActionKinds with a natural home claim
// a default route (Calendly owns propose/confirm_booking; Zoom owns
// create_video_meeting). The rest are reached by the DispatchContext.channel
// hint: when an inbox thread flows through Slack / Google Calendar / Google Meet,
// the inbox pins dispatch to that exact channel (see lib/integrations/registry).
import type { ActionKind } from "@/lib/gates";
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

interface InboxChannelSpec {
  channel: string;
  // Any of these env vars present => real credentials are configured.
  envVars: string[];
  // ActionKinds this channel is the DEFAULT route for. May be empty for
  // channels reached only via the DispatchContext.channel hint.
  handles: ActionKind[];
  // Prose describing the prepared (mock) outcome, e.g. "Drafted a Slack reply".
  prepared: (target: string) => string;
  // Prose describing the not-yet-delivered outcome for a channel the org has
  // connected but that has no real provider call wired up yet.
  notDelivered: (target: string) => string;
  // A plausible external reference (booking/meeting URL) to attach in mock
  // (not-connected) mode only, so downstream surfaces (the inbox thread, the
  // Outbox) have something illustrative to show. Never attached to a
  // not-delivered result — a fabricated link there would be presented as a
  // completed action's outcome, which is exactly what this fixes.
  mockReference?: (ctx: DispatchContext) => string | undefined;
}

function makeModule(spec: InboxChannelSpec): AdapterModule {
  const configured = () => spec.envVars.some((v) => Boolean(process.env[v]));

  const adapter: DispatchAdapter = {
    channel: spec.channel,
    isConfigured: configured,
    async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
      const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
      // Per-org connection wins when the caller resolved it; else the env default.
      if (!(ctx.connected ?? configured())) {
        return {
          ok: true,
          channel: spec.channel,
          live: false,
          detail: spec.prepared(target),
          reference: spec.mockReference?.(ctx),
        };
      }
      // SEAM: the real provider call goes here once OAuth credential plumbing
      // lands. Until then, report this honestly as NOT delivered — there is no
      // queue or worker that will ever send it, so claiming "queued" (as this
      // used to) told the operator a message went out when nothing left the
      // building. ok:false here is what flips the associated task/thread away
      // from reading "completed".
      return {
        ok: false,
        channel: spec.channel,
        live: false,
        detail: spec.notDelivered(target),
        error: `${spec.channel} sending is not yet wired up — nothing was delivered to ${target}.`,
      };
    },
  };

  return { handles: spec.handles, adapter };
}

// A deterministic, obviously-fake link for mock (not-connected) preview mode
// only — never a real endpoint, and never attached to a not-delivered result.
function mockLink(provider: string): string {
  return `https://mock.fundexecs.local/${provider}/${Math.random().toString(36).slice(2, 8)}`;
}

export const slackModule = makeModule({
  channel: "slack",
  envVars: ["SLACK_BOT_TOKEN"],
  handles: [], // messaging replies route here only via the channel hint
  prepared: (t) => `Drafted a Slack reply to ${t} (Slack not connected — saved to review).`,
  notDelivered: (t) => `Slack reply to ${t} was not sent — Slack sending isn't wired up yet.`,
});

export const googleCalendarModule = makeModule({
  channel: "google_calendar",
  envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CALENDAR_ACCESS_TOKEN"],
  handles: [], // booking on a Google Calendar thread routes here via the channel hint
  prepared: (t) => `Prepared a Google Calendar invite for ${t} (Google not connected).`,
  notDelivered: (t) => `Google Calendar invite for ${t} was not sent — Google Calendar sending isn't wired up yet.`,
  mockReference: () => mockLink("gcal"),
});

export const zoomModule = makeModule({
  channel: "zoom",
  envVars: ["ZOOM_CLIENT_ID", "ZOOM_ACCOUNT_ID"],
  handles: ["create_video_meeting"],
  prepared: (t) => `Prepared a Zoom meeting for ${t} (Zoom not connected).`,
  notDelivered: (t) => `Zoom meeting for ${t} was not created — Zoom sending isn't wired up yet.`,
  mockReference: () => mockLink("zoom"),
});

export const googleMeetModule = makeModule({
  channel: "google_meet",
  envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_MEET_ACCESS_TOKEN"],
  handles: [], // video on a Google Meet thread routes here via the channel hint
  prepared: (t) => `Prepared a Google Meet for ${t} (Google not connected).`,
  notDelivered: (t) => `Google Meet for ${t} was not created — Google Meet sending isn't wired up yet.`,
  mockReference: () => mockLink("meet"),
});

export const INBOX_MODULES: AdapterModule[] = [
  slackModule,
  googleCalendarModule,
  zoomModule,
  googleMeetModule,
];
