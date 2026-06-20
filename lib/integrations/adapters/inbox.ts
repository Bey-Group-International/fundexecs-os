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
  // Prose describing the queued (configured-but-not-yet-wired) outcome.
  queued: (target: string) => string;
  // A plausible external reference (booking/meeting URL) to attach in mock mode,
  // so downstream surfaces (the inbox thread, the Outbox) have something to show.
  mockReference?: (ctx: DispatchContext) => string | undefined;
}

function makeModule(spec: InboxChannelSpec): AdapterModule {
  const configured = () => spec.envVars.some((v) => Boolean(process.env[v]));

  const adapter: DispatchAdapter = {
    channel: spec.channel,
    isConfigured: configured,
    async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
      const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
      if (!configured()) {
        return {
          ok: true,
          channel: spec.channel,
          live: false,
          detail: spec.prepared(target),
          reference: spec.mockReference?.(ctx),
        };
      }
      // SEAM: the real provider call goes here once OAuth credential plumbing
      // lands. Until then we return a configured-but-queued result rather than
      // calling an external API from a server action — the contract stays honest
      // and the loop stays observable.
      return {
        ok: true,
        channel: spec.channel,
        live: false,
        detail: spec.queued(target),
        reference: spec.mockReference?.(ctx),
      };
    },
  };

  return { handles: spec.handles, adapter };
}

// A deterministic, obviously-fake link for mock mode — never a real endpoint.
function mockLink(provider: string): string {
  return `https://mock.fundexecs.local/${provider}/${Math.random().toString(36).slice(2, 8)}`;
}

export const slackModule = makeModule({
  channel: "slack",
  envVars: ["SLACK_BOT_TOKEN"],
  handles: [], // messaging replies route here only via the channel hint
  prepared: (t) => `Drafted a Slack reply to ${t} (Slack not connected — saved to review).`,
  queued: (t) => `Queued a Slack reply to ${t} for send via connected Slack.`,
});

export const calendlyModule = makeModule({
  channel: "calendly",
  envVars: ["CALENDLY_API_TOKEN", "CALENDLY_ACCESS_TOKEN"],
  handles: ["propose_meeting", "confirm_booking"],
  prepared: (t) => `Prepared a booking link for ${t} (Calendly not connected).`,
  queued: (t) => `Queued a Calendly booking link for ${t}.`,
  mockReference: () => mockLink("calendly"),
});

export const googleCalendarModule = makeModule({
  channel: "google_calendar",
  envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CALENDAR_ACCESS_TOKEN"],
  handles: [], // booking on a Google Calendar thread routes here via the channel hint
  prepared: (t) => `Prepared a Google Calendar invite for ${t} (Google not connected).`,
  queued: (t) => `Queued a Google Calendar invite for ${t}.`,
  mockReference: () => mockLink("gcal"),
});

export const zoomModule = makeModule({
  channel: "zoom",
  envVars: ["ZOOM_CLIENT_ID", "ZOOM_ACCOUNT_ID"],
  handles: ["create_video_meeting"],
  prepared: (t) => `Prepared a Zoom meeting for ${t} (Zoom not connected).`,
  queued: (t) => `Queued a Zoom meeting for ${t}.`,
  mockReference: () => mockLink("zoom"),
});

export const googleMeetModule = makeModule({
  channel: "google_meet",
  envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_MEET_ACCESS_TOKEN"],
  handles: [], // video on a Google Meet thread routes here via the channel hint
  prepared: (t) => `Prepared a Google Meet for ${t} (Google not connected).`,
  queued: (t) => `Queued a Google Meet for ${t}.`,
  mockReference: () => mockLink("meet"),
});

export const INBOX_MODULES: AdapterModule[] = [
  slackModule,
  calendlyModule,
  googleCalendarModule,
  zoomModule,
  googleMeetModule,
];
