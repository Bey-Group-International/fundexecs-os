#!/usr/bin/env tsx
//
// Check a change to supabase/migrations before it merges.
//
//   npx tsx scripts/check-migrations.ts [base-ref]
//
// Base ref defaults to $GITHUB_BASE_REF (set on pull_request events), then to
// `origin/main`. Run it locally before pushing a migration; CI runs it from
// .github/workflows/migration-check.yml.
//
// All of the judgement lives in lib/db/migration-rules.ts, which is pure and
// tested. This file only resolves what changed, from git, and prints it in the
// form GitHub renders as inline annotations.
//
// WHAT THIS CANNOT SEE. The worst of the three failure shapes described in
// migration-rules.ts is a migration whose version was already recorded in
// production because the SQL was applied out of band -- `db push` then skips
// the file and whatever actually ran is never compared against it. Detecting
// that needs the remote migration history, which means production credentials,
// and this check deliberately has none: it runs on `pull_request`, where the
// workflow file comes from the branch, so a secret available here is a secret
// available to anything anyone pushes. `db-migrate.yml` detects that shape
// instead, on main, by reading the history before it pushes.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import {
  checkMigrations,
  hasErrors,
  MIGRATIONS_DIR,
  type AddedMigration,
  type Finding,
  type ModifiedMigration,
} from "../lib/db/migration-rules";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function gitOrNull(...args: string[]): string | null {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

/** Escape a value for the body of a GitHub workflow command. */
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Escape a value for a `key=value` property of a GitHub workflow command. */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * True only inside Actions. Elsewhere the `::error file=...::` form is noise --
 * worse, its percent-encoding mangles the shell snippets in the advice, so
 * `date -u +%Y%m%d%H%M%S` reads as `+%25Y%25m...` for anyone running this
 * locally. GitHub decodes that; a terminal does not.
 */
const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

function annotate(finding: Finding): void {
  const level = finding.severity === "error" ? "error" : "warning";

  if (!IN_ACTIONS) {
    const where = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
    console.log(`${level === "error" ? "ERROR  " : "warning"}  ${where}`);
    console.log(`         ${finding.title} (${finding.rule})`);
    console.log(`         ${finding.detail}`);
    console.log("");
    return;
  }

  const props = [
    `file=${escapeProperty(finding.file)}`,
    finding.line === undefined ? null : `line=${finding.line}`,
    `title=${escapeProperty(finding.title)}`,
  ]
    .filter((p): p is string => p !== null)
    .join(",");
  console.log(`::${level} ${props}::${escapeData(finding.detail)}`);
}

/** A workflow command in Actions, a plain line anywhere else. */
function note(level: "notice" | "error", title: string, detail: string): void {
  if (IN_ACTIONS) {
    console.log(`::${level} title=${escapeProperty(title)}::${escapeData(detail)}`);
    return;
  }
  console.log(`${level === "error" ? "ERROR" : "note"}: ${title} -- ${detail}`);
}

/** Basenames of every migration in a given tree. */
function migrationNamesAt(ref: string): string[] {
  const out = gitOrNull("ls-tree", "--name-only", "-r", ref, "--", `${MIGRATIONS_DIR}/`);
  if (out === null) return [];
  return out
    .split("\n")
    .filter((line) => line.endsWith(".sql"))
    .map((line) => line.slice(`${MIGRATIONS_DIR}/`.length));
}

function fileAt(ref: string, name: string): string {
  return gitOrNull("show", `${ref}:${MIGRATIONS_DIR}/${name}`) ?? "";
}

interface Changes {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Names changed between two refs.
 *
 * `--no-renames` is deliberate. A renamed migration is not a rename as far as
 * production is concerned: the version and the name are what get recorded, so
 * moving a merged file to a new name deletes a version production still holds
 * and introduces one it does not. Reporting it as a delete plus an add is what
 * lets the rules say both of those things.
 */
function changedBetween(base: string, head: string): Changes {
  const out =
    gitOrNull("diff", "--name-status", "--no-renames", base, head, "--", `${MIGRATIONS_DIR}/`) ??
    "";
  const changes: Changes = { added: [], modified: [], deleted: [] };

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [status, path] = line.split("\t");
    if (!path?.endsWith(".sql")) continue;
    const name = path.slice(`${MIGRATIONS_DIR}/`.length);
    if (status.startsWith("A")) changes.added.push(name);
    else if (status.startsWith("M")) changes.modified.push(name);
    else if (status.startsWith("D")) changes.deleted.push(name);
  }

  return changes;
}

/**
 * What to diff against, when no base was given on the command line.
 *
 * A pull request compares against its own base branch. A push to main has to
 * compare against the commit before it: `origin/main` IS the pushed commit
 * there, so a merge base with it is the commit itself and the diff is always
 * empty -- which would make the main run silently report nothing and give
 * exactly the false reassurance this check exists to remove.
 *
 * `github.event.before` is all-zeros on a branch's first push and unreliable
 * after a force-push, so HEAD~1 is the fallback, and `origin/main` the last
 * resort for a local run on a feature branch.
 */
function resolveBaseRef(): string {
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase) return `origin/${prBase}`;

  if (process.env.GITHUB_EVENT_NAME === "push") {
    const before = process.env.GITHUB_EVENT_BEFORE;
    if (before && !/^0+$/.test(before) && gitOrNull("cat-file", "-e", `${before}^{commit}`) !== null) {
      return before;
    }
    if (gitOrNull("rev-parse", "--verify", "HEAD~1") !== null) return "HEAD~1";
  }

  return "origin/main";
}

function summarise(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const lines: string[] = ["## Migration check", ""];

  if (findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }

  lines.push(`${errors.length} error(s), ${warnings.length} warning(s).`, "");

  for (const group of [
    { label: "Errors", items: errors },
    { label: "Warnings", items: warnings },
  ]) {
    if (group.items.length === 0) continue;
    lines.push(`### ${group.label}`, "");
    for (const f of group.items) {
      const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
      lines.push(`- **${f.title}** — \`${where}\` (\`${f.rule}\`)`, `  ${f.detail}`, "");
    }
  }

  return lines.join("\n");
}

function main(): number {
  const explicit = process.argv[2];
  const baseRef = explicit ?? resolveBaseRef();
  const isPullRequest = process.env.GITHUB_EVENT_NAME === "pull_request";

  const mergeBase = gitOrNull("merge-base", baseRef, "HEAD")?.trim();

  if (!mergeBase) {
    const message =
      `Could not find a merge base between ${baseRef} and HEAD. On a shallow clone, ` +
      "give actions/checkout `fetch-depth: 0` so the base branch is available.";
    if (isPullRequest) {
      // Passing silently here would reproduce the exact problem this check
      // exists to fix: a migration reaching main with nothing having looked at
      // it, under a green tick.
      note("error", "Migration check could not run", message);
      return 1;
    }
    note("notice", "Migration check skipped", message);
    return 0;
  }

  const changes = changedBetween(mergeBase, "HEAD");
  const touched = changes.added.length + changes.modified.length + changes.deleted.length;

  if (touched === 0) {
    note("notice", "Migration check", `No migrations changed against ${baseRef}.`);
    return 0;
  }

  const added: AddedMigration[] = changes.added.map((name) => ({
    name,
    sql: fileAt("HEAD", name),
  }));
  const modified: ModifiedMigration[] = changes.modified.map((name) => ({
    name,
    sql: fileAt("HEAD", name),
    baseSql: fileAt(mergeBase, name),
  }));

  const findings = checkMigrations({
    baseNames: migrationNamesAt(mergeBase),
    headNames: migrationNamesAt("HEAD"),
    added,
    modified,
    deleted: changes.deleted,
  });

  for (const finding of findings) annotate(finding);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;

  console.log("");
  console.log(`Base            ${baseRef} (merge base ${mergeBase.slice(0, 12)})`);
  console.log(`Added           ${changes.added.join(", ") || "none"}`);
  console.log(`Modified        ${changes.modified.join(", ") || "none"}`);
  console.log(`Deleted         ${changes.deleted.join(", ") || "none"}`);
  console.log(`Findings        ${errors} error(s), ${warnings} warning(s)`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    // Appended rather than written: other steps may add to the same summary.
    appendFileSync(summaryPath, `${summarise(findings)}\n`);
  }

  if (hasErrors(findings)) {
    console.log("");
    console.log(
      "These are errors because each one means the migration will not do what the " +
        "repository says it does, with every other check still green. See " +
        "supabase/migrations/README.md.",
    );
    return 1;
  }

  return 0;
}

process.exit(main());
