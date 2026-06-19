// lib/integrations/adapters/index.ts
// The registered dispatch adapters. Each concrete adapter lives in its own file
// and exports an AdapterModule; the registry assembles them into the routing
// map. Add a new channel by implementing an adapter and appending its module
// here. ActionKinds claimed by no module fall back to the mock adapter.
import type { AdapterModule } from "../types";
import { gmailModule } from "./gmail";
import { docusignModule } from "./docusign";

export const ADAPTERS: AdapterModule[] = [gmailModule, docusignModule];
