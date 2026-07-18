// lib/terminal/types.ts
// The terminal command language contract. A CommandDefinition mirrors the
// discipline of a SkillManifest (lib/skills/types.ts): a command declares its
// interface, the permission scopes it needs, its side-effect level (which resolves
// through the action contract), and whether it can dry-run. Pure types — the
// registry and parser below are dependency-free and testable.

import type { ExecutiveKey } from "@/lib/executives/registry";
import type { SideEffectLevel } from "./action-contract";

export type CommandCategory = "navigation" | "analysis" | "workflow";

/** One positional/keyword argument a command accepts. */
export interface CommandArg {
  name: string;
  /** The whole remainder of the input after the verb (e.g. an entity name). */
  rest?: boolean;
  required: boolean;
  description: string;
}

export interface CommandDefinition {
  /** Canonical verb, upper-case by convention (e.g. "DEAL", "LBO", "ASK EARN"). */
  verb: string;
  /** Case-insensitive aliases. */
  aliases: string[];
  category: CommandCategory;
  description: string;
  example: string;
  args: CommandArg[];
  /** Permission scopes required (extends lib/api-keys API_SCOPES vocabulary). */
  requiredScopes: string[];
  /** The operational executive that owns the work, when applicable. */
  agentOwner?: ExecutiveKey;
  /** Side-effect level → resolved to a gate tier by the action contract. */
  sideEffect: SideEffectLevel;
  dryRunnable: boolean;
}

/** The result of parsing a raw command-bar input against the registry. */
export interface ParsedCommand {
  /** The matched command definition. */
  command: CommandDefinition;
  /** The raw input, verbatim. */
  raw: string;
  /** Resolved argument values keyed by arg name. */
  args: Record<string, string>;
}
