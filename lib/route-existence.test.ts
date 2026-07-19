import { existsSync } from "fs";
import path from "path";
import { navCommands } from "./nav-commands";
import { HUBS } from "./hubs";
import { dashboardWorkspaces } from "./dashboard/config";

const APP_ROOT = path.join(process.cwd(), "app", "(app)");

function normalizeHref(href: string): string {
  return href.split("#")[0].split("?")[0].replace(/\/$/, "") || "/";
}

function routeExists(href: string): boolean {
  const clean = normalizeHref(href);
  const parts = clean.split("/").filter(Boolean);
  const candidates = [path.join(APP_ROOT, ...parts, "page.tsx")];

  if (parts.length > 0) {
    candidates.push(path.join(APP_ROOT, ...parts.slice(0, -1), "[id]", "page.tsx"));
    candidates.push(path.join(APP_ROOT, ...parts.slice(0, -1), "[roomId]", "page.tsx"));
  }

  if (parts.length === 1) {
    candidates.push(path.join(APP_ROOT, "[hub]", "page.tsx"));
  }

  if (parts.length === 2) {
    candidates.push(path.join(APP_ROOT, "[hub]", "[module]", "page.tsx"));
  }

  return candidates.some(existsSync);
}

function expectRoute(href: string) {
  expect(routeExists(href)).toBe(true);
}

describe("route existence", () => {
  it("has pages for every global command href", () => {
    for (const command of navCommands()) {
      expectRoute(command.href);
    }
  });

  it("has pages for every hub module", () => {
    const missing: string[] = [];
    for (const hub of HUBS) {
      if (!routeExists(`/${hub.key}`)) missing.push(`/${hub.key}`);
      for (const mod of hub.modules) {
        const href = `/${hub.key}/${mod.key}`;
        if (!routeExists(href)) missing.push(href);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has pages for dashboard workspace hrefs", () => {
    for (const workspace of dashboardWorkspaces) {
      expectRoute(workspace.href);
    }
  });
});
