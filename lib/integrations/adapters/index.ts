// lib/integrations/adapters/index.ts
// The registered dispatch adapters. Each concrete adapter lives in its own file
// and exports an AdapterModule; the registry assembles them into the routing
// map. Add a new channel by implementing an adapter and appending its module
// here. ActionKinds claimed by no module fall back to the mock adapter.
import type { AdapterModule } from "../types";
import { gmailModule } from "./gmail";
import { docusignModule } from "./docusign";
import { slackModule } from "./slack";
import { INBOX_MODULES } from "./inbox";

// slackModule is appended last so, as the final module to claim the "slack"
// channel, it supersedes the inbox placeholder for channel-pinned dispatch (the
// Act-now Radar digest pins to "slack" via the DispatchContext.channel hint).
export const ADAPTERS: AdapterModule[] = [
  gmailModule,
  docusignModule,
  ...INBOX_MODULES,
  slackModule,
];
