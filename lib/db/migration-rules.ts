// Rules about migration FILES, as opposed to the schema they describe.
//
// Why this exists: nothing in this repository has ever checked a migration
// before it merged. `ci.yml` runs lint, typecheck and build; `jest.yml` filters
// to `**/*.ts`-ish paths. Neither looks at `supabase/migrations/**`, so a
// migration-only pull request was reviewed by humans and bots and by no check
// at all. The first automated opinion arrived from `db-migrate.yml` AFTER the
// merge, running against production.
//
// That is survivable for a migration that is merely wrong -- it goes red on
// main and someone fixes it. It is not survivable for the three shapes below,
// because each of them is GREEN everywhere and still wrong:
//
//   1. Editing a migration that already merged. Its version is already in
//      `supabase_migrations.schema_migrations`, and `supabase db push` applies
//      a version at most once. The edit never runs. The repository and
//      production disagree from then on, and nothing says so.
//
//   2. Deleting a migration that already merged. Production keeps the version
//      row; the directory loses the file. `db push` then refuses outright --
//      "Remote migration versions not found in local migrations directory" --
//      so EVERY later migration is blocked by bookkeeping. That is not
//      hypothetical: it happened in July 2026 and is written up in
//      docs/removed-migrations/README.md.
//
//   3. Adding a migration whose version is ALREADY recorded in production,
//      because the SQL was applied out of band first (a hand-run, or
//      `apply_migration` against the live project, both of which stamp a
//      version immediately). `db push` skips the file as already applied. What
//      production actually ran was whatever was typed at the time, which is
//      not necessarily what the committed file says. Nothing compares them.
//
// Rules 1 and 2 need no database access at all -- they are facts about the diff
// -- which is why they live here and run on every pull request. Rule 3 needs
// the remote history, so the pull-request check cannot see it and
// `db-migrate.yml` detects it instead, by reading the history BEFORE it pushes.
//
// This module is deliberately pure: it takes file names and file text and
// returns findings. Git and GitHub live in scripts/check-migrations.ts.

/** `error` fails the check. `warning` annotates and passes. */
export type Severity = "error" | "warning";

export interface Finding {
  /** Stable identifier, so annotations can be grouped and tests can assert. */
  rule: string;
  severity: Severity;
  /** Repo-relative path, or `supabase/migrations` for directory-level findings. */
  file: string;
  /** 1-indexed, when the finding is about a specific statement. */
  line?: number;
  title: string;
  detail: string;
}

export interface AddedMigration {
  /** Basename, e.g. `20261001050707_drop_meeting_related_company_id.sql`. */
  name: string;
  sql: string;
}

export interface ModifiedMigration {
  name: string;
  /** Contents after the change. */
  sql: string;
  /** Contents on the base branch. */
  baseSql: string;
}

export interface CheckInput {
  /** Every migration basename on the base branch. */
  baseNames: string[];
  /** Every migration basename after this change, for duplicate detection. */
  headNames: string[];
  added: AddedMigration[];
  modified: ModifiedMigration[];
  /** Basenames this change removes. */
  deleted: string[];
}

export const MIGRATIONS_DIR = "supabase/migrations";

/**
 * The form required of a NEW migration: a 14-digit UTC timestamp, an
 * underscore, then a lowercase snake_case name.
 *
 * The 66 four-digit files (`0001_init.sql` ... `0066_artifact_grounding.sql`)
 * predate this and are grandfathered by construction: they are only ever in
 * `baseNames`, never in `added`, so no rule here looks at them.
 */
const NEW_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/** Any name this directory accepts, new or legacy. Used to read a version out. */
const ANY_NAME = /^(\d{4}|\d{14})_/;

export function versionOf(name: string): string | null {
  const m = ANY_NAME.exec(name);
  return m ? m[1] : null;
}

/**
 * A 14-digit version is a UTC timestamp. A typo is permanent: the version is
 * what orders the migration and what gets recorded, and neither can be changed
 * afterwards without a repair against production.
 */
export function isPlausibleTimestamp(version: string): boolean {
  if (!/^\d{14}$/.test(version)) return false;
  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  const hour = Number(version.slice(8, 10));
  const minute = Number(version.slice(10, 12));
  const second = Number(version.slice(12, 14));
  if (year < 2000 || year > 2199) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return true;
}

/**
 * Blank out everything that is not executable SQL, preserving line structure so
 * reported line numbers still match the file.
 *
 * Replaced with spaces: `--` comments, `/* *\/` comments (nested, as
 * PostgreSQL allows), single-quoted strings, and dollar-quoted blocks.
 *
 * Blanking dollar-quoted blocks is not incidental -- it is what makes the
 * re-runnability lint below agree with this repository's convention. The
 * convention is to wrap a non-idempotent statement in
 *
 *   do $$ begin if not exists (select 1 from pg_constraint where ...) then ...
 *
 * and the body of that block is exactly where an unguarded-looking statement is
 * in fact guarded. Blanking the body means a correctly guarded migration
 * produces no finding, and an unguarded one at top level still does.
 *
 * It also stops the lint reading the prose. These files are mostly commentary
 * and the commentary quotes SQL constantly -- the file this module was written
 * alongside contains the words "add constraint live_meetings_deal_org_fk" four
 * times in comments. Linting the raw text would flag every one.
 */
export function stripNonCode(sql: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(sql.slice(i, stop));
      i = stop;
      continue;
    }

    if (sql.startsWith("/*", i)) {
      let depth = 0;
      const start = i;
      while (i < n) {
        if (sql.startsWith("/*", i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else {
          i += 1;
        }
      }
      out += blank(sql.slice(start, i));
      continue;
    }

    if (sql[i] === "'") {
      // `E'...'` is an escape string, where a backslash escapes the next
      // character -- so `E'it\'s'` is ONE literal and the `\'` does not end it.
      // An ordinary `'...'` has no backslash escape while
      // standard_conforming_strings is on, which is the default.
      //
      // Getting this wrong is not cosmetic, and it is not hypothetical: six
      // migrations here use E-strings. Treating `\'` as the closing quote
      // inverts the in-string/in-code state for the rest of the file -- the
      // literal's contents get scanned as code, and the real SQL after it gets
      // blanked as though it were a string. Measured before this branch
      // existed, `select E'it\'s fine'; create table t (id int);` reported NO
      // findings, because the `create table` had been swallowed into a
      // phantom string. A false negative here ships an unguarded migration
      // silently, which is the one outcome this lint exists to prevent.
      const prev = i > 0 ? sql[i - 1] : "";
      const beforePrev = i > 1 ? sql[i - 2] : "";
      const isEscapeString =
        (prev === "E" || prev === "e") && !/[A-Za-z0-9_$]/.test(beforePrev);

      const start = i;
      i += 1;
      while (i < n) {
        if (isEscapeString && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += blank(sql.slice(start, i));
      continue;
    }

    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
    if (dollar) {
      const tag = dollar[0];
      const start = i;
      i += tag.length;
      const close = sql.indexOf(tag, i);
      i = close === -1 ? n : close + tag.length;
      out += blank(sql.slice(start, i));
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

interface Statement {
  text: string;
  /** 1-indexed line on which the statement starts. */
  line: number;
}

/**
 * Split stripped SQL into statements on `;`, normalised to lowercase with
 * collapsed whitespace. Semicolons inside strings, comments and dollar-quoted
 * blocks are already blanked by stripNonCode, so splitting here is safe.
 */
export function statementsOf(sql: string): Statement[] {
  const stripped = stripNonCode(sql);
  const out: Statement[] = [];
  let offset = 0;

  for (const chunk of stripped.split(";")) {
    const text = chunk.replace(/\s+/g, " ").trim().toLowerCase();
    if (text) {
      // The statement starts at its first non-blank character, not at the
      // semicolon that ended the one before it.
      const lead = chunk.length - chunk.replace(/^\s+/, "").length;
      out.push({ text, line: countLines(stripped, offset + lead) });
    }
    offset += chunk.length + 1;
  }

  return out;
}

function countLines(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

interface RerunRule {
  rule: string;
  /** Matches a statement that needs checking. */
  match: RegExp;
  /** When present and it matches, the statement is already safe. */
  guarded?: RegExp;
  /**
   * How to read the created object's kind and name, for the drop-then-create
   * idiom below. When the same kind and name were dropped with `if exists`
   * earlier in the file, the create is re-runnable and nothing is reported.
   */
  object?: { kind: string; name: RegExp };
  advice: string;
}

// A note on why these are written as match + guarded pairs rather than as one
// regex with a negative lookahead. The obvious single-regex form
//
//   /^create (unique )?index (concurrently )?(?!if not exists)/
//
// is WRONG, and quietly: given `create index concurrently if not exists i ...`
// the engine first matches `concurrently ` and fails the lookahead, then
// backtracks, matches `(concurrently )?` as empty, finds `concurrently` where it
// checked for `if not exists`, and the lookahead now succeeds -- so a correctly
// guarded statement is reported as unguarded. Any optional group BETWEEN the
// keyword and the lookahead has that failure mode. Splitting the two halves
// removes the possibility rather than relying on getting the backtracking right.
//
// Where no optional group sits between the keyword and the guard, a lookahead is
// safe and is preferred, because it catches EVERY occurrence in a statement --
// `alter table t drop column if exists a, drop column b` needs to be flagged for
// the second clause, and a whole-statement `guarded` test would pass it.

/**
 * Statements that error on a second apply, and what makes each one safe.
 *
 * Why re-runnability is a property worth linting here rather than a style
 * preference: migrations in this repository get hand-applied out of band, and
 * the recovery from that (see supabase/migrations/README.md) is to repair the
 * history and let `db push` run the file again. A file that cannot be applied
 * twice cannot be recovered that way. The convention is already near-universal
 * -- 14 of the 17 migrations that add a constraint carry the `pg_constraint`
 * guard -- this only makes it visible when it is missed.
 *
 * Every entry is unambiguous: either PostgreSQL offers IF NOT EXISTS / IF
 * EXISTS / OR REPLACE for that statement, in which case its absence is the
 * finding, or it offers none, in which case the statement must sit inside a
 * guard block and being seen at top level IS the finding.
 */
const RERUN_RULES: RerunRule[] = [
  {
    rule: "create-table-unguarded",
    match: /^create (unlogged )?table\b/,
    guarded: /^create (unlogged )?table if not exists\b/,
    object: { kind: "table", name: /^create (?:unlogged )?table ([^\s(]+)/ },
    advice: "use `create table if not exists`",
  },
  {
    rule: "create-index-unguarded",
    match: /^create (unique )?index\b/,
    guarded: /^create (unique )?index (concurrently )?if not exists\b/,
    object: { kind: "index", name: /^create (?:unique )?index (?:concurrently )?(\S+) on\b/ },
    advice: "use `create index if not exists`",
  },
  {
    rule: "create-matview-unguarded",
    match: /^create materialized view\b/,
    guarded: /^create materialized view if not exists\b/,
    advice: "use `create materialized view if not exists`",
  },
  {
    rule: "create-schema-unguarded",
    match: /^create schema\b/,
    guarded: /^create schema if not exists\b/,
    advice: "use `create schema if not exists`",
  },
  {
    rule: "create-extension-unguarded",
    match: /^create extension\b/,
    guarded: /^create extension if not exists\b/,
    advice: "use `create extension if not exists`",
  },
  {
    // Lookahead is safe here, and wanted: it flags the second clause of
    // `add column if not exists a int, add column b int`.
    rule: "add-column-unguarded",
    match: /\badd column(?! if not exists\b)/,
    advice: "use `add column if not exists`",
  },
  {
    rule: "drop-unguarded",
    match:
      /\bdrop (?:materialized view|table|index|view|column|constraint|policy|trigger|function|procedure|type|schema|extension|publication)(?! if exists\b)/,
    advice: "add `if exists`",
  },
  {
    rule: "add-constraint-unguarded",
    match: /\badd constraint\b/,
    object: { kind: "constraint", name: /\badd constraint (\S+)/ },
    advice:
      "PostgreSQL has no `add constraint if not exists`; wrap it in a `do $$ ... if not exists (select 1 from pg_constraint where conname = ... and conrelid = ...::regclass) then ... end $$` block as the rest of this directory does, or `drop constraint if exists` the same name first",
  },
  {
    rule: "create-policy-unguarded",
    match: /^create policy\b/,
    object: { kind: "policy", name: /^create policy (\S+)/ },
    advice:
      "PostgreSQL has no `create policy if not exists`; precede it with `drop policy if exists` on the same name, or wrap it in a guard block",
  },
  {
    rule: "create-type-unguarded",
    match: /^create type\b/,
    object: { kind: "type", name: /^create type (\S+)/ },
    advice:
      "PostgreSQL has no `create type if not exists`; wrap it in a `do $$ ... if not exists (select 1 from pg_type where typname = ...) then ... end $$` block, or `drop type if exists` it first",
  },
  {
    rule: "create-trigger-unguarded",
    match: /^create trigger\b/,
    object: { kind: "trigger", name: /^create trigger (\S+)/ },
    advice: "use `create or replace trigger`, or precede it with `drop trigger if exists`",
  },
  {
    rule: "create-function-unguarded",
    match: /^create (function|procedure)\b/,
    advice: "use `create or replace`",
  },
  {
    rule: "create-view-unguarded",
    match: /^create view\b/,
    advice: "use `create or replace view`",
  },
  {
    rule: "insert-not-idempotent",
    match: /^insert into\b/,
    guarded: /\bon conflict\b/,
    advice: "add `on conflict do nothing` (or a conflict target) so a second apply is a no-op",
  },
];

/**
 * Object names dropped with `if exists` anywhere in the file, as `kind:name`.
 *
 * This is what makes the drop-then-create idiom pass. PostgreSQL has no
 * `create policy if not exists`, so the only way to write a re-runnable policy
 * is
 *
 *   drop policy if exists p on public.t;
 *   create policy p on public.t ...;
 *
 * and that is what this repository actually does -- it is how
 * 20260930190000_inbox_thread_drafts.sql handles both of its policies. A lint
 * that read the `create` alone would call a correct file wrong, which is the
 * fastest way to get a check ignored. The same idiom covers constraints
 * (`drop constraint if exists` then `add constraint`), triggers, types,
 * indexes and tables.
 *
 * Names are compared on their last dot-separated segment with quotes removed,
 * so `public."p"` and `p` are the same object.
 */
function droppedIfExists(statements: Statement[]): Set<string> {
  const dropped = new Set<string>();

  const add = (kind: string, raw: string | undefined) => {
    if (!raw) return;
    dropped.add(`${kind}:${bareName(raw)}`);
  };

  for (const { text } of statements) {
    // `drop policy if exists p on public.t` / `drop trigger if exists g on public.t`
    const onObject = /\bdrop (policy|trigger) if exists (\S+) on\b/.exec(text);
    if (onObject) add(onObject[1], onObject[2]);

    // `alter table t drop constraint if exists k`
    const constraint = /\bdrop constraint if exists ([^\s,]+)/.exec(text);
    if (constraint) add("constraint", constraint[1]);

    // `drop table if exists t`, `drop index if exists i`, and friends
    const plain =
      /\bdrop (materialized view|table|index|view|type|schema|extension|function|procedure|publication) if exists ([^\s,(]+)/.exec(
        text,
      );
    if (plain) add(plain[1], plain[2]);
  }

  return dropped;
}

function bareName(raw: string): string {
  const segments = raw.replace(/"/g, "").split(".");
  return segments[segments.length - 1];
}

/** Re-runnability findings for one migration's SQL. Warnings, never errors. */
export function lintRerunnability(name: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  const file = `${MIGRATIONS_DIR}/${name}`;
  const statements = statementsOf(sql);
  const dropped = droppedIfExists(statements);

  for (const stmt of statements) {
    for (const rule of RERUN_RULES) {
      if (!rule.match.test(stmt.text)) continue;
      if (rule.guarded?.test(stmt.text)) continue;
      if (rule.object) {
        const named = rule.object.name.exec(stmt.text);
        if (named && dropped.has(`${rule.object.kind}:${bareName(named[1])}`)) continue;
      }
      findings.push({
        rule: rule.rule,
        severity: "warning",
        file,
        line: stmt.line,
        title: "Migration may not survive a second apply",
        detail:
          `This statement errors if the migration runs twice: ${rule.advice}. ` +
          "Migrations here get hand-applied out of band, so recovering one means " +
          "repairing the history and letting `db push` run the file again -- which " +
          "only works if the file is idempotent.",
      });
      break; // One finding per statement is enough to act on.
    }
  }

  return findings;
}

/** Highest 14-digit version among these names, or null if there are none. */
export function highestTimestampedVersion(names: string[]): string | null {
  const versions = names
    .map(versionOf)
    .filter((v): v is string => v !== null && /^\d{14}$/.test(v));
  if (versions.length === 0) return null;
  return versions.reduce((a, b) => (a > b ? a : b));
}

/**
 * Every finding for one change to supabase/migrations.
 *
 * Errors are the three silent shapes described at the top of this file, plus
 * the bookkeeping mistakes that cause them (a malformed or colliding version).
 * Everything else is a warning, on purpose: a check that blocks on judgement
 * calls gets switched off, and this repository already carries two workflows
 * that failed for weeks without anybody noticing. Erroring only where the
 * failure is certain is what keeps the signal worth reading.
 */
export function checkMigrations(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  const baseNames = new Set(input.baseNames);
  const baseVersions = new Map<string, string>();
  for (const name of input.baseNames) {
    const version = versionOf(name);
    if (version) baseVersions.set(version, name);
  }

  // 1. A merged migration must not be edited.
  for (const file of input.modified) {
    if (!baseNames.has(file.name)) continue; // Added and edited in the same change.
    const path = `${MIGRATIONS_DIR}/${file.name}`;

    const before = stripNonCode(file.baseSql).replace(/\s+/g, " ").trim();
    const after = stripNonCode(file.sql).replace(/\s+/g, " ").trim();

    if (before === after) {
      // Comment-only. These files are mostly prose and improving it is welcome.
      findings.push({
        rule: "merged-migration-comment-only-edit",
        severity: "warning",
        file: path,
        title: "Comments changed on a migration that has already been applied",
        detail:
          "Only the commentary differs, so nothing executable changed and this is fine. " +
          "Noting it because the file's SQL can no longer be changed -- its version is " +
          "already recorded in production and `db push` will never run it again.",
      });
      continue;
    }

    findings.push({
      rule: "merged-migration-edited",
      severity: "error",
      file: path,
      title: "Executable SQL changed in a migration that has already been applied",
      detail:
        `${file.name} is on the base branch, so its version is already recorded in ` +
        "`supabase_migrations.schema_migrations`. `supabase db push` applies a version at " +
        "most once, so this edit will NEVER run against production -- the repository would " +
        "claim one schema and production would have another, with every check green. " +
        "Put the change in a NEW migration instead. If the intent is to correct SQL that " +
        "has not reached production yet, say so in the pull request: it needs a history " +
        "repair, not an edit.",
    });
  }

  // 2. A merged migration must not be deleted.
  for (const name of input.deleted) {
    if (!baseNames.has(name)) continue;
    findings.push({
      rule: "merged-migration-deleted",
      severity: "error",
      file: `${MIGRATIONS_DIR}/${name}`,
      title: "A migration that has already been applied was deleted",
      detail:
        `${name} is on the base branch, so production has its version row. Removing the ` +
        "file leaves the remote history holding a version this directory cannot explain, " +
        "and `supabase db push` then refuses to run AT ALL -- \"Remote migration versions " +
        "not found in local migrations directory\" -- which blocks every later migration, " +
        "not just this one. That is what happened in July 2026; see " +
        "docs/removed-migrations/README.md. To undo what this migration did, add a new " +
        "migration that reverses it. If the file is genuinely orphaned, its SQL belongs in " +
        "docs/removed-migrations/ and the version needs `supabase migration repair " +
        "--status reverted` against production first.",
    });
  }

  // 3. Names, versions and collisions, for added files only.
  for (const file of input.added) {
    const path = `${MIGRATIONS_DIR}/${file.name}`;
    const match = NEW_NAME.exec(file.name);

    if (!match) {
      findings.push({
        rule: "bad-filename",
        severity: "error",
        file: path,
        title: "Migration filename is not in the required form",
        detail:
          "A new migration must be named `<14-digit UTC timestamp>_<snake_case>.sql`, for " +
          "example `20261001050707_drop_meeting_related_company_id.sql`. The timestamp is " +
          "what orders the migration and what gets recorded remotely. (The 66 four-digit " +
          "files in this directory predate the convention and are left alone.)",
      });
      continue;
    }

    const version = match[1];

    if (!isPlausibleTimestamp(version)) {
      findings.push({
        rule: "implausible-timestamp",
        severity: "error",
        file: path,
        title: `Version ${version} is not a real UTC timestamp`,
        detail:
          "The 14 digits are read as YYYYMMDDHHMMSS. This one is not a valid date and time, " +
          "which means it will sort somewhere unintended and be recorded that way " +
          "permanently. Use the current UTC time: `date -u +%Y%m%d%H%M%S`.",
      });
    }

    const clash = baseVersions.get(version);
    if (clash && clash !== file.name) {
      findings.push({
        rule: "version-collision",
        severity: "error",
        file: path,
        title: `Version ${version} is already used by ${clash}`,
        detail:
          "Two files cannot share a version. Production records the version, not the " +
          "filename, so whichever is applied first permanently prevents the other from " +
          "ever running. Re-stamp this file with a fresh `date -u +%Y%m%d%H%M%S`.",
      });
    }
  }

  // Duplicates within the change itself, which the base-branch check above cannot see.
  const seen = new Map<string, string[]>();
  for (const name of input.headNames) {
    const version = versionOf(name);
    if (!version) continue;
    seen.set(version, [...(seen.get(version) ?? []), name]);
  }
  for (const [version, names] of seen) {
    if (names.length < 2) continue;
    findings.push({
      rule: "duplicate-version",
      severity: "error",
      file: MIGRATIONS_DIR,
      title: `Version ${version} appears ${names.length} times`,
      detail:
        `${names.sort().join(", ")} share one version. Production records the version, so ` +
        "only one of them can ever be applied and the rest are silently skipped forever.",
    });
  }

  // 4. Out-of-order versions. A warning, because this repository embraces them.
  const highestBase = highestTimestampedVersion(input.baseNames);
  if (highestBase) {
    for (const file of input.added) {
      const version = versionOf(file.name);
      if (!version || !/^\d{14}$/.test(version)) continue;
      if (version > highestBase) continue;
      findings.push({
        rule: "out-of-order-version",
        severity: "warning",
        file: `${MIGRATIONS_DIR}/${file.name}`,
        title: `Version ${version} sorts before the base branch's latest (${highestBase})`,
        detail:
          "`db-migrate.yml` runs `db push --include-all`, so this WILL be applied -- but " +
          "after migrations stamped later have already run. That is routine when parallel " +
          "branches merge out of order, and it is only safe if this file does not depend on " +
          "the schema as it stood at its own timestamp. Check that it does not, or re-stamp " +
          "it with a fresh `date -u +%Y%m%d%H%M%S`.",
      });
    }
  }

  // 5. Re-runnability, for added files only.
  for (const file of input.added) {
    findings.push(...lintRerunnability(file.name, file.sql));
  }

  return findings;
}

/** True when any finding would fail the check. */
export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
