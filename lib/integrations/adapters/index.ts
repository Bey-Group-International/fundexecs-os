// lib/integrations/adapters/index.ts
// The registered dispatch adapters. Each concrete adapter lives in its own file
// and exports an AdapterModule; the registry assembles them into the routing
// map. Add a new channel by implementing an adapter and appending its module
// here. ActionKinds claimed by no module fall back to the mock adapter.
import type { AdapterModule } from "../types";
import { gmailModule } from "./gmail";
import { docusignModule } from "./docusign";
import { nativeMeetingModule } from "./native-meeting";
import { calendlyModule } from "./calendly";
import { slackModule } from "./slack";
import { INBOX_MODULES } from "./inbox";
import { FINANCE_MODULES } from "./finance";

// registry.ts resolves both ActionKind routing and channel routing on a
// last-module-wins basis, so registration order IS the precedence rule. Real
// or native adapters must be registered AFTER any mock/placeholder that claims
// the same ActionKind or channel string, or the mock silently shadows them —
// this previously routed every meeting action to the inbox's permanently-mock
// calendly placeholder (since deleted; ./inbox no longer defines one) even
// with the real Calendly adapter configured. registry.test.ts asserts these
// outcomes.
//
// - INBOX_MODULES / FINANCE_MODULES go first: they are placeholders for
//   channels with no real adapter (yet), reachable by their channel string
//   until something below supersedes them.
// - calendlyModule (real) is registered after them so an explicit
//   channel="calendly" hint always reaches it.
// - nativeMeetingModule is registered after calendlyModule so native meeting
//   rooms — zero external dependency, always live — win the generic
//   propose_meeting / confirm_booking ActionKind route by default. An explicit
//   channel="calendly" hint still reaches the real Calendly adapter via
//   CHANNEL_ROUTING regardless of this ActionKind precedence.
// - slackModule (real, native inbox delivery) is last so it wins the "slack"
//   channel string over the inbox's mock Slack placeholder.
export const ADAPTERS: AdapterModule[] = [
  gmailModule,
  docusignModule,
  ...INBOX_MODULES,
  ...FINANCE_MODULES,
  calendlyModule,
  nativeMeetingModule,
  slackModule,
];
