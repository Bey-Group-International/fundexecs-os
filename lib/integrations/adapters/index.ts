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

// Registration order determines channel ownership when multiple modules claim
// the same ActionKind:
// - nativeMeetingModule is before calendlyModule so it wins propose_meeting /
//   confirm_booking — meeting rooms are generated natively.
// - slackModule is last so it supersedes the inbox Slack placeholder for
//   channel-pinned dispatch (the Radar digest pins to "slack").
export const ADAPTERS: AdapterModule[] = [
  gmailModule,
  docusignModule,
  nativeMeetingModule,
  calendlyModule,
  ...INBOX_MODULES,
  ...FINANCE_MODULES,
  slackModule,
];
