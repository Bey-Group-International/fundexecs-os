// Tests for the command parser + registry consistency.
import { parseCommand, isComplete } from "./parse";
import { getCommand, listCommands, allVerbTokens } from "./commands/registry";
import { classifySideEffect } from "./action-contract";

describe("parseCommand", () => {
  it("parses a single-word verb + rest arg, preserving entity casing", () => {
    const p = parseCommand("DEAL Maple Street");
    expect(p).not.toBeNull();
    expect(p!.command.verb).toBe("DEAL");
    expect(p!.args.entity).toBe("Maple Street");
  });

  it("is case-insensitive on the verb", () => {
    expect(parseCommand("deal Acme")!.command.verb).toBe("DEAL");
    expect(parseCommand("LbO Maple")!.command.verb).toBe("LBO");
  });

  it("resolves aliases to the canonical command", () => {
    expect(parseCommand("INVESTOR Redwood")!.command.verb).toBe("LP");
    expect(parseCommand("PIPELINE")!.command.verb).toBe("PIPE");
  });

  it("matches the LONGEST verb prefix first (multi-word verbs)", () => {
    const ask = parseCommand("ASK EARN analyze Maple Street and prep an IC memo");
    expect(ask!.command.verb).toBe("ASK EARN");
    expect(ask!.args.request).toBe("analyze Maple Street and prep an IC memo");
    const create = parseCommand("CREATE DEAL Maple Street");
    expect(create!.command.verb).toBe("CREATE DEAL");
    expect(create!.args.name).toBe("Maple Street");
  });

  it("handles a no-arg command", () => {
    const p = parseCommand("PIPE");
    expect(p!.command.verb).toBe("PIPE");
    expect(Object.keys(p!.args)).toHaveLength(0);
  });

  it("returns null for an unknown verb (falls back to NL path)", () => {
    expect(parseCommand("frobnicate the widget")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });

  it("isComplete flags a required arg that is missing", () => {
    expect(isComplete(parseCommand("DEAL")!)).toBe(false); // entity required, absent
    expect(isComplete(parseCommand("DEAL Acme")!)).toBe(true);
    expect(isComplete(parseCommand("PIPE")!)).toBe(true); // no required args
  });
});

describe("command registry consistency", () => {
  it("every command's side-effect resolves to a valid gate tier", () => {
    for (const cmd of listCommands()) {
      expect([1, 2, 3]).toContain(classifySideEffect(cmd.sideEffect).tier);
    }
  });

  it("capital commands are Tier-3 capital-binding (non-delegable)", () => {
    for (const verb of ["CAPCALL", "DISTRIBUTE"]) {
      const cmd = getCommand(verb)!;
      expect(cmd.sideEffect).toBe("capital-binding");
      expect(classifySideEffect(cmd.sideEffect).tier).toBe(3);
    }
  });

  it("navigation/entity commands are read-only", () => {
    for (const verb of ["DEAL", "FUND", "LP", "PIPE", "WATCH", "ALERTS"]) {
      expect(getCommand(verb)!.sideEffect).toBe("read-only");
    }
  });

  it("every verb token resolves back to a command; verbs are upper-case", () => {
    for (const token of allVerbTokens()) {
      expect(getCommand(token)).not.toBeNull();
      expect(token).toBe(token.toUpperCase());
    }
  });

  it("every command carries a description, example, and required scopes", () => {
    for (const cmd of listCommands()) {
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.example.length).toBeGreaterThan(0);
      expect(cmd.requiredScopes.length).toBeGreaterThan(0);
    }
  });
});
