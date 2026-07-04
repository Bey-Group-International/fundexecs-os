// Coverage for the global palette catalog (audit P2 — one palette, one
// catalog). The invariants that made the old hardcoded catalog rot: every hub
// module must be present with its real /{hub}/{module} route, and hrefs must
// be well-formed and unique so the palette can never ship a dead or duplicate
// entry again.
import { navCommands } from "./nav-commands";
import { HUBS } from "./hubs";

describe("navCommands", () => {
  const commands = navCommands();

  it("includes every hub module at its real route", () => {
    for (const hub of HUBS) {
      for (const m of hub.modules) {
        expect(commands.some((c) => c.href === `/${hub.key}/${m.key}`)).toBe(true);
      }
    }
  });

  it("has well-formed, unique hrefs", () => {
    const hrefs = commands.map((c) => c.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/[a-z0-9\-_/#]+$/i);
      expect(href).not.toContain(" ");
    }
  });

  it("labels and groups every command", () => {
    for (const c of commands) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.group.length).toBeGreaterThan(0);
    }
  });

  it("routes legacy deal and report concepts to implemented pages", () => {
    expect(commands.find((c) => c.label === "Deals")?.href).toBe("/deals/feed");
    expect(commands.some((c) => c.href === "/lp-report")).toBe(false);
  });
});
