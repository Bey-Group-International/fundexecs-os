// scripts/try-pe-skill.ts
// Try a PE department skill on your own input, with no database and no deployment.
//
//   npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts --list
//   npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts bid-range
//   npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts bid-range path/to/my-input.json
//   npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts bid-range - < my-input.json
//   npx tsx --tsconfig tsconfig.json scripts/try-pe-skill.ts --all     (every PE skill on its shipped example, one line each)
//   add --json to print only the raw SkillResult
//
// With no input file it uses the skill's shipped example (skills/<id>/examples/example-1.json).
// This runs the governed core exactly as the app does (authorisation, input validation, the
// deterministic core, output validation) but it does NOT read an organization's saved settings:
// the firm's mandate, hurdles, limits and gate owners are whatever you put in the input, and
// anything you leave out falls back to the labelled standing default. Nothing is saved or sent.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { SKILL_GATES } from "@/lib/pe/gates";
import { canRunSkill } from "@/lib/executives/registry";
import { executeSkillCore } from "@/lib/skills/runner";
import { getSkill } from "@/lib/skills/registry";
import type { SkillContext } from "@/lib/skills/types";

const args = process.argv.slice(2);
const json = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("--"));

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (args.includes("--all")) {
  let bad = 0;
  for (const id of Object.keys(SKILL_GATES).sort()) {
    const sk = getSkill(id);
    const file = join(
      process.cwd(),
      "skills",
      id,
      "examples",
      "example-1.json",
    );
    if (!sk || !existsSync(file)) {
      console.log(`${id.padEnd(26)} NO EXAMPLE`);
      bad++;
      continue;
    }
    const exec =
      sk.manifest.applicableExecutives.find((e) => canRunSkill(e, id)) ??
      sk.manifest.applicableExecutives[0];
    const r = executeSkillCore(
      id,
      JSON.parse(readFileSync(file, "utf8")).input,
      { workspaceId: "try-it", principalId: "try-it", executive: exec },
    );
    const gate = (r.structured as { gate?: string } | null)?.gate ?? "";
    console.log(
      `${id.padEnd(26)} ${(r.ok ? "ok" : "FAILED").padEnd(7)} completeness ${String(Math.round(r.completeness * 100)).padStart(3)}%  flagged ${String(r.missingData.length).padStart(2)}  ${gate}`,
    );
    if (!r.ok) bad++;
  }
  process.exit(bad ? 2 : 0);
}

if (args.includes("--list") || positional.length === 0) {
  console.log("PE skills (gate in brackets):\n");
  for (const [id, gate] of Object.entries(SKILL_GATES).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const s = getSkill(id);
    console.log(
      `  ${id.padEnd(26)} ${(s?.manifest.name ?? "?").padEnd(34)} [${gate.label}]`,
    );
  }
  console.log("\nUsage: try-pe-skill.ts <skill-id> [input.json | -] [--json]");
  process.exit(positional.length === 0 && !args.includes("--list") ? 1 : 0);
}

const skillId = positional[0];
const skill = getSkill(skillId);
if (!skill || !SKILL_GATES[skillId])
  fail(`"${skillId}" is not a PE skill. Run with --list to see them.`);

let raw: string;
const src = positional[1];
if (src === "-") raw = readFileSync(0, "utf8");
else if (src) {
  if (!existsSync(src)) fail(`No such file: ${src}`);
  raw = readFileSync(src, "utf8");
} else {
  const example = join(
    process.cwd(),
    "skills",
    skillId,
    "examples",
    "example-1.json",
  );
  if (!existsSync(example))
    fail(`No shipped example for ${skillId}; pass an input file.`);
  raw = readFileSync(example, "utf8");
  console.error(`(using skills/${skillId}/examples/example-1.json)`);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  fail(
    `That input is not valid JSON: ${e instanceof Error ? e.message : "parse error"}`,
  );
}
// An example file wraps the input as { "input": {...} }; accept either shape.
const input =
  parsed &&
  typeof parsed === "object" &&
  !Array.isArray(parsed) &&
  "input" in (parsed as object)
    ? (parsed as { input: unknown }).input
    : parsed;

const executive =
  skill.manifest.applicableExecutives.find((e) => canRunSkill(e, skillId)) ??
  skill.manifest.applicableExecutives[0];
const ctx: SkillContext = {
  workspaceId: "try-it",
  principalId: "try-it",
  executive,
};
const result = executeSkillCore(skillId, input, ctx);

if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

const structured = (result.structured ?? {}) as Record<string, unknown>;
const line = "-".repeat(72);
console.log(line);
console.log(
  `${skill.manifest.name} (${skillId} v${result.version}) as ${executive}`,
);
console.log(line);
console.log(
  `Status:        ${result.status}${result.ok ? "" : "  <-- did not complete"}`,
);
console.log(
  `Confidence:    ${Math.round(result.confidence * 100)}%    Completeness: ${Math.round(result.completeness * 100)}%`,
);
console.log(
  `Approval tier: ${result.approvalTier}${result.requiresApproval ? " (a human must approve any follow-on)" : " (advisory)"}`,
);
if (typeof structured.gate === "string")
  console.log(`Human gate:    ${structured.gate}`);
if (!result.inputValidation.valid) {
  console.log("\nYour input was rejected:");
  for (const e of result.inputValidation.errors) console.log(`  - ${e}`);
}
if (result.warnings.length) {
  console.log("\nWarnings:");
  for (const w of result.warnings) console.log(`  - ${w}`);
}
if (result.missingData.length) {
  console.log(
    `\nFlagged as missing or assumed (${result.missingData.length}):`,
  );
  for (const m of result.missingData) console.log(`  - ${m}`);
}
const assumptions = result.sources.filter((s) => s.kind === "assumption");
if (assumptions.length) {
  console.log(`\nAssumptions and labelled defaults (${assumptions.length}):`);
  for (const a of assumptions)
    console.log(
      `  - ${a.label}: ${String(a.value)}${a.ref ? `  [${a.ref}]` : ""}`,
    );
}
console.log(`\nSummary:\n  ${result.narrative}`);
if (result.structured) {
  console.log("\nStructured output:");
  console.log(JSON.stringify(result.structured, null, 2));
}
process.exit(result.ok ? 0 : 2);
