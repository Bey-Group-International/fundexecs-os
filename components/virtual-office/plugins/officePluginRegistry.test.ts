import {
  OfficePluginRegistry,
  definePlugin,
  type OfficeContext,
} from "./officePluginRegistry";

const reg = () => new OfficePluginRegistry();

describe("panel registration + ordering", () => {
  it("returns panels for a slot sorted by order then id", () => {
    const r = reg();
    r.registerPanel({ id: "b", title: "B", slot: "hud", order: 1 });
    r.registerPanel({ id: "a", title: "A", slot: "hud", order: 1 });
    r.registerPanel({ id: "z", title: "Z", slot: "hud", order: 0 });
    expect(r.panelsFor("hud").map((p) => p.id)).toEqual(["z", "a", "b"]);
  });

  it("filters by slot", () => {
    const r = reg();
    r.registerPanel({ id: "h", title: "H", slot: "hud" });
    r.registerPanel({ id: "l", title: "L", slot: "left" });
    expect(r.panelsFor("hud").map((p) => p.id)).toEqual(["h"]);
    expect(r.panelsFor("left").map((p) => p.id)).toEqual(["l"]);
  });

  it("throws on duplicate id unless override is set", () => {
    const r = reg();
    r.registerPanel({ id: "x", title: "X", slot: "hud" });
    expect(() => r.registerPanel({ id: "x", title: "X2", slot: "hud" })).toThrow(/already registered/);
    r.registerPanel({ id: "x", title: "X2", slot: "hud" }, true);
    expect(r.panelsFor("hud")[0].title).toBe("X2");
  });
});

describe("visibleWhen gating", () => {
  it("respects a context predicate on panels", () => {
    const r = reg();
    r.registerPanel({
      id: "trading-only",
      title: "Deals",
      slot: "right",
      visibleWhen: (ctx: OfficeContext) => ctx.roomKey === "trading",
    });
    expect(r.panelsFor("right", { roomKey: "trading" })).toHaveLength(1);
    expect(r.panelsFor("right", { roomKey: "ceo" })).toHaveLength(0);
  });

  it("respects a context predicate on commands", () => {
    const r = reg();
    r.registerCommand({
      id: "approve",
      label: "Approve",
      kind: "event",
      target: "office:approve",
      visibleWhen: (ctx) => ctx.role === "managing_partner",
    });
    expect(r.commandsFor({ role: "managing_partner" })).toHaveLength(1);
    expect(r.commandsFor({ role: "analyst" })).toHaveLength(0);
  });
});

describe("plugin bundles", () => {
  const plugin = definePlugin({
    id: "deal-tools",
    panels: [
      { id: "deal-panel", title: "Deals", slot: "right" },
      { id: "deal-hud", title: "Deal HUD", slot: "hud" },
    ],
    commands: [{ id: "new-deal", label: "New Deal", kind: "navigate", target: "/deals/new" }],
  });

  it("stamps each contribution with the plugin id as source", () => {
    const r = reg();
    r.register(plugin);
    expect(r.panelsFor("right")[0].source).toBe("deal-tools");
    expect(r.commandsFor()[0].source).toBe("deal-tools");
  });

  it("unregister removes exactly what the plugin added", () => {
    const r = reg();
    r.registerPanel({ id: "core", title: "Core", slot: "hud" }); // pre-existing
    const teardown = r.register(plugin);
    expect(r.allPanels()).toHaveLength(3);
    expect(r.allCommands()).toHaveLength(1);
    teardown();
    expect(r.allPanels().map((p) => p.id)).toEqual(["core"]); // plugin panels gone, core stays
    expect(r.allCommands()).toHaveLength(0);
  });

  it("clear removes everything", () => {
    const r = reg();
    r.register(plugin);
    r.clear();
    expect(r.allPanels()).toHaveLength(0);
    expect(r.allCommands()).toHaveLength(0);
  });
});
