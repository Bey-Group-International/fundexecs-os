// lib/nav-commands.ts
// The navigation command catalog for the ONE global command palette. Pure
// (no React, no I/O): nav/settings destinations verified against real routes,
// every hub module generated from lib/hubs.ts (the routing source of truth,
// so the palette can never drift into 404s), and the dashboard workspaces.
import { HUBS } from "@/lib/hubs";
import { dashboardWorkspaces } from "@/lib/dashboard/config";

export interface NavCommand {
  label: string;
  href: string;
  hint: string;
  group: string;
}

const BASE_COMMANDS: NavCommand[] = [
  { label: "Command Center", href: "/dashboard", hint: "Main HUD", group: "nav" },
  { label: "Earn Workspace", href: "/workspace", hint: "Create a workflow", group: "nav" },
  { label: "Automated Sessions", href: "/automations", hint: "Workflow automation", group: "nav" },
  { label: "Inbox", href: "/inbox", hint: "Unified messages", group: "nav" },
  { label: "Search", href: "/search", hint: "Full-text search", group: "nav" },
  { label: "Graphs", href: "/graph", hint: "Three graphs", group: "nav" },
  { label: "Capital Map", href: "/capital-map", hint: "Relationship intelligence", group: "nav" },
  { label: "Portfolio", href: "/portfolio", hint: "Portfolio health", group: "nav" },
  { label: "Deals", href: "/deals/feed", hint: "Deal signal feed", group: "nav" },
  { label: "Envelopes", href: "/envelopes", hint: "Native e-sign", group: "nav" },
  { label: "Settings", href: "/settings", hint: "Account & org", group: "settings" },
  { label: "Integrations", href: "/settings#integrations", hint: "Connect tools", group: "settings" },
];

// /{hub}/{module} is exactly what app/(app)/[hub]/[module] serves.
const HUB_COMMANDS: NavCommand[] = HUBS.flatMap((hub) =>
  hub.modules.map((m) => ({
    label: `${hub.label}: ${m.label}`,
    href: `/${hub.key}/${m.key}`,
    hint: hub.label,
    group: hub.key as string,
  })),
);

/** The full navigation catalog, in presentation order. */
export function navCommands(): NavCommand[] {
  return [
    ...BASE_COMMANDS,
    ...HUB_COMMANDS,
    ...dashboardWorkspaces.map((workspace) => ({
      label: workspace.title,
      href: workspace.href,
      hint: workspace.eyebrow,
      group: "workspace",
    })),
  ];
}
