// lib/terminal/parse.ts
// Parse a raw command-bar input into a ParsedCommand against the registry. Pure,
// dependency-free, no backtracking. Handles multi-word verbs ("ASK EARN",
// "CREATE DEAL") by matching the LONGEST verb prefix first, then binds the
// remaining text to the command's `rest` argument. Returns null when the input is
// not a recognized command (the caller then falls back to the "ask earn" NL path).

import { getCommand } from "./commands/registry";
import type { CommandDefinition, ParsedCommand } from "./types";

/** Max number of leading tokens that can form a verb (e.g. "CREATE DEAL"). */
const MAX_VERB_TOKENS = 2;

function bindArgs(command: CommandDefinition, rest: string): Record<string, string> {
  const args: Record<string, string> = {};
  const restArg = command.args.find((a) => a.rest);
  if (restArg && rest) args[restArg.name] = rest;
  return args;
}

/**
 * Parse `input` into a command + args, or null when no verb matches. The verb
 * match is case-insensitive; the remaining text is passed through verbatim (only
 * outer whitespace trimmed) so entity names keep their casing.
 */
export function parseCommand(input: string): ParsedCommand | null {
  const raw = typeof input === "string" ? input : "";
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);

  // Longest verb prefix wins: try the first MAX_VERB_TOKENS, then fewer.
  for (let n = Math.min(MAX_VERB_TOKENS, tokens.length); n >= 1; n--) {
    const verb = tokens.slice(0, n).join(" ");
    const command = getCommand(verb);
    if (command) {
      const rest = tokens.slice(n).join(" ");
      return { command, raw: trimmed, args: bindArgs(command, rest) };
    }
  }
  return null;
}

/**
 * Whether a parsed command has every required argument present. A command with a
 * missing required arg is still returned by `parseCommand` (so the UI can prompt
 * for it) — this predicate tells the runtime whether it is ready to dispatch.
 */
export function isComplete(parsed: ParsedCommand): boolean {
  return parsed.command.args
    .filter((a) => a.required)
    .every((a) => Boolean(parsed.args[a.name]?.trim()));
}
