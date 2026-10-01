import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkMigrations,
  hasErrors,
  highestTimestampedVersion,
  isPlausibleTimestamp,
  lintRerunnability,
  statementsOf,
  stripNonCode,
  versionOf,
  type CheckInput,
} from "./migration-rules";

const empty: CheckInput = {
  baseNames: [],
  headNames: [],
  added: [],
  modified: [],
  deleted: [],
};

function input(over: Partial<CheckInput>): CheckInput {
  return { ...empty, ...over };
}

function rules(findings: { rule: string }[]): string[] {
  return findings.map((f) => f.rule).sort();
}

describe("versionOf", () => {
  it("reads a 14-digit version", () => {
    expect(versionOf("20261001050707_drop_meeting_related_company_id.sql")).toBe(
      "20261001050707",
    );
  });

  it("reads a legacy 4-digit version", () => {
    expect(versionOf("0001_init.sql")).toBe("0001");
  });

  it("returns null for anything else", () => {
    expect(versionOf("README.md")).toBeNull();
    expect(versionOf("add_thing.sql")).toBeNull();
  });
});

describe("isPlausibleTimestamp", () => {
  it("accepts a real UTC timestamp", () => {
    expect(isPlausibleTimestamp("20261001050707")).toBe(true);
  });

  it("rejects an impossible month, day, hour, minute or second", () => {
    expect(isPlausibleTimestamp("20261301050707")).toBe(false); // month 13
    expect(isPlausibleTimestamp("20261032050707")).toBe(false); // day 32
    expect(isPlausibleTimestamp("20261001250707")).toBe(false); // hour 25
    expect(isPlausibleTimestamp("20261001056007")).toBe(false); // minute 60
    expect(isPlausibleTimestamp("20261001050760")).toBe(false); // second 60
  });

  it("rejects a wrong length", () => {
    expect(isPlausibleTimestamp("2026100105070")).toBe(false);
    expect(isPlausibleTimestamp("0001")).toBe(false);
  });
});

describe("stripNonCode", () => {
  it("blanks line comments but keeps the line count", () => {
    const stripped = stripNonCode("-- drop table users;\nselect 1;\n");
    expect(stripped).not.toContain("drop table");
    expect(stripped.split("\n")).toHaveLength(3);
    expect(stripped).toContain("select 1;");
  });

  it("blanks nested block comments", () => {
    const stripped = stripNonCode("/* outer /* inner drop table x */ still */ select 1;");
    expect(stripped).not.toContain("drop table");
    expect(stripped).toContain("select 1;");
  });

  it("blanks single-quoted strings, including doubled quotes", () => {
    const stripped = stripNonCode("select 'drop table x', 'it''s drop table y';");
    expect(stripped).not.toContain("drop table");
    expect(stripped).toContain("select");
  });

  it("blanks dollar-quoted blocks and tagged variants", () => {
    expect(stripNonCode("do $$ drop table x; $$;")).not.toContain("drop table");
    expect(stripNonCode("do $body$ drop table x; $body$;")).not.toContain("drop table");
  });

  it("keeps an E-string's backslash-escaped quote inside the literal", () => {
    // Six migrations here use E-strings. Before this was handled, closing the
    // literal at `\'` inverted the in-string/in-code state for the rest of the
    // file: the literal was scanned as code and the real SQL after it was
    // blanked as a phantom string, so the `create table` below went unreported.
    const sql = String.raw`select E'it\'s fine';
create table t (id int);`;
    const stripped = stripNonCode(sql);
    expect(stripped).toContain("create table t (id int);");
    expect(stripped).not.toContain("fine");
    expect(rules(lintRerunnability("20260101000000_x.sql", sql))).toEqual([
      "create-table-unguarded",
    ]);
  });

  it("treats a lower-case e-string the same way", () => {
    const sql = String.raw`select e'a\'b'; create table t (id int);`;
    expect(rules(lintRerunnability("20260101000000_x.sql", sql))).toEqual([
      "create-table-unguarded",
    ]);
  });

  it("does not mistake an identifier ending in e for an E-string prefix", () => {
    // `value'...'` is not valid SQL, but the guard must not fire on a trailing
    // `e` that belongs to a longer word -- otherwise a backslash in an ordinary
    // string would start consuming pairs.
    const sql = String.raw`select 'a\', 'b'; create table t (id int);`;
    const stripped = stripNonCode(sql);
    expect(stripped).toContain("create table t (id int);");
  });

  it("does not treat a different closing tag as the end of a block", () => {
    const stripped = stripNonCode("do $a$ select $$ drop table x; $a$; select 2;");
    expect(stripped).not.toContain("drop table");
    expect(stripped).toContain("select 2;");
  });

  it("leaves an unterminated block blanked to the end rather than throwing", () => {
    expect(() => stripNonCode("do $$ drop table x;")).not.toThrow();
    expect(stripNonCode("do $$ drop table x;")).not.toContain("drop table");
  });
});

describe("statementsOf", () => {
  it("splits on semicolons and normalises whitespace and case", () => {
    const stmts = statementsOf("CREATE   TABLE\n  foo (id int);\nselect 1;");
    expect(stmts.map((s) => s.text)).toEqual(["create table foo (id int)", "select 1"]);
  });

  it("ignores semicolons inside comments, strings and dollar blocks", () => {
    const stmts = statementsOf("do $$ begin a; b; end $$;\n-- x; y;\nselect 1;");
    expect(stmts).toHaveLength(2);
    expect(stmts[1].text).toBe("select 1");
  });

  it("reports the line a statement starts on", () => {
    const stmts = statementsOf("-- a comment\n\nselect 1;\n\nselect 2;\n");
    expect(stmts[0].line).toBe(3);
    expect(stmts[1].line).toBe(5);
  });
});

describe("lintRerunnability", () => {
  const warn = (sql: string) => rules(lintRerunnability("20260101000000_x.sql", sql));

  it("flags DDL that errors on a second apply", () => {
    expect(warn("create table t (id int);")).toEqual(["create-table-unguarded"]);
    expect(warn("create index i on t (c);")).toEqual(["create-index-unguarded"]);
    expect(warn("create unique index i on t (c);")).toEqual(["create-index-unguarded"]);
    expect(warn("alter table t add column c int;")).toEqual(["add-column-unguarded"]);
    expect(warn("alter table t drop column c;")).toEqual(["drop-unguarded"]);
    expect(warn("alter table t add constraint k check (c > 0);")).toEqual([
      "add-constraint-unguarded",
    ]);
    expect(warn("create policy p on t for select using (true);")).toEqual([
      "create-policy-unguarded",
    ]);
    expect(warn("create type s as enum ('a');")).toEqual(["create-type-unguarded"]);
    expect(warn("create trigger g before insert on t execute function f();")).toEqual([
      "create-trigger-unguarded",
    ]);
    expect(warn("create function f() returns int as 'select 1' language sql;")).toEqual([
      "create-function-unguarded",
    ]);
    expect(warn("create view v as select 1;")).toEqual(["create-view-unguarded"]);
    expect(warn("create materialized view m as select 1;")).toEqual([
      "create-matview-unguarded",
    ]);
    expect(warn("insert into t (c) values (1);")).toEqual(["insert-not-idempotent"]);
  });

  it("accepts the guarded form of each", () => {
    expect(warn("create table if not exists t (id int);")).toEqual([]);
    expect(warn("create index if not exists i on t (c);")).toEqual([]);
    expect(warn("create unique index if not exists i on t (c);")).toEqual([]);
    expect(warn("create index concurrently if not exists i on t (c);")).toEqual([]);
    expect(warn("alter table t add column if not exists c int;")).toEqual([]);
    expect(warn("alter table t drop column if exists c;")).toEqual([]);
    expect(warn("create or replace view v as select 1;")).toEqual([]);
    expect(warn("create or replace function f() returns int as 'select 1' language sql;")).toEqual(
      [],
    );
    expect(warn("create or replace trigger g before insert on t execute function f();")).toEqual(
      [],
    );
    expect(warn("insert into t (c) values (1) on conflict do nothing;")).toEqual([]);
  });

  it("treats a statement inside a do-block as guarded, which is this repo's convention", () => {
    const sql = `
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where conname = 'k' and conrelid = 'public.t'::regclass
        ) then
          alter table public.t add constraint k check (c > 0);
        end if;
      end $$;
    `;
    expect(warn(sql)).toEqual([]);
  });

  it("accepts the drop-then-create idiom, which is the only re-runnable form for a policy", () => {
    // Taken from 20260930190000_inbox_thread_drafts.sql, which is correct and
    // which an earlier version of this lint reported as unguarded.
    expect(
      warn(`
        drop policy if exists d_select on public.d;
        create policy d_select on public.d for select using (true);
      `),
    ).toEqual([]);
    expect(
      warn(`
        drop trigger if exists g on public.t;
        create trigger g before insert on public.t execute function f();
      `),
    ).toEqual([]);
    expect(
      warn(`
        alter table public.t drop constraint if exists k;
        alter table public.t add constraint k check (c > 0);
      `),
    ).toEqual([]);
    expect(warn("drop type if exists s; create type s as enum ('a');")).toEqual([]);
    expect(warn("drop index if exists i; create index i on t (c);")).toEqual([]);
  });

  it("matches a dropped name regardless of schema qualification or quoting", () => {
    expect(
      warn(`
        drop policy if exists d_select on public.d;
        create policy "d_select" on public.d for select using (true);
      `),
    ).toEqual([]);
    expect(warn('drop index if exists public."i"; create index i on t (c);')).toEqual([]);
  });

  it("still flags a create whose name was never dropped", () => {
    expect(
      warn(`
        drop policy if exists other on public.d;
        create policy d_select on public.d for select using (true);
      `),
    ).toEqual(["create-policy-unguarded"]);
  });

  it("does not read SQL quoted in prose", () => {
    const sql = `
      -- This migration does NOT run: create table t (id int);
      -- nor: alter table public.t add constraint k check (c > 0);
      /* and definitely not: drop column related_company_id; */
      select 1;
    `;
    expect(warn(sql)).toEqual([]);
  });

  it("flags a later unguarded clause even when an earlier one is guarded", () => {
    // The whole-statement form of this test would pass, which is why `drop` and
    // `add column` use a lookahead instead of a `guarded` regex.
    expect(warn("alter table t drop column if exists a, drop column b;")).toEqual([
      "drop-unguarded",
    ]);
    expect(warn("alter table t add column if not exists a int, add column b int;")).toEqual([
      "add-column-unguarded",
    ]);
  });

  it("does not mistake a guarded concurrent index for an unguarded one", () => {
    // The regression this rule table was restructured for: an optional group
    // between the keyword and a negative lookahead backtracks into a false
    // positive. Both spellings must stay clean.
    expect(warn("create index concurrently if not exists i on t (c);")).toEqual([]);
    expect(warn("create unique index concurrently if not exists i on t (c);")).toEqual([]);
  });

  it("reports one finding per statement, not one per matching rule", () => {
    const findings = lintRerunnability(
      "20260101000000_x.sql",
      "alter table t add column c int, add constraint k check (c > 0);",
    );
    expect(findings).toHaveLength(1);
  });

  it("is warning-only", () => {
    const findings = lintRerunnability("20260101000000_x.sql", "create table t (id int);");
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(hasErrors(findings)).toBe(false);
  });

  it("produces nothing for the real guarded migrations in this repository", () => {
    // The strongest available check against false positives. These files are all
    // correctly re-runnable, and each exercises a different way of being so:
    // the first four are `do $$ ... if not exists (pg_constraint)` guards and
    // quote their own SQL repeatedly in prose, which is what a naive line-based
    // lint gets wrong; the last two use drop-then-create for policies and
    // triggers, which is what the first version of this lint got wrong.
    //
    // They are safe to assert on because they are merged migrations, and
    // `merged-migration-edited` now makes editing one an error.
    const names = [
      "20261001001500_meeting_related_contact_fk.sql",
      "20261001033517_meeting_related_fund_fk.sql",
      "20261001042344_meeting_deal_org_fk.sql",
      "20261001050707_drop_meeting_related_company_id.sql",
      "20260930190000_inbox_thread_drafts.sql",
      "20260930200000_documents_large_uploads_and_view_controls.sql",
    ];
    for (const name of names) {
      const sql = readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
      expect(lintRerunnability(name, sql)).toEqual([]);
    }
  });
});

describe("checkMigrations: a merged migration must not be edited", () => {
  const base = ["20260101000000_thing.sql"];

  it("errors when executable SQL changes", () => {
    const findings = checkMigrations(
      input({
        baseNames: base,
        headNames: base,
        modified: [
          {
            name: "20260101000000_thing.sql",
            baseSql: "create table if not exists a (id int);",
            sql: "create table if not exists b (id int);",
          },
        ],
      }),
    );
    expect(rules(findings)).toEqual(["merged-migration-edited"]);
    expect(hasErrors(findings)).toBe(true);
  });

  it("only warns when nothing but comments changed", () => {
    const findings = checkMigrations(
      input({
        baseNames: base,
        headNames: base,
        modified: [
          {
            name: "20260101000000_thing.sql",
            baseSql: "-- old note\ncreate table if not exists a (id int);",
            sql: "-- a much longer and better note\ncreate table if not exists a (id int);",
          },
        ],
      }),
    );
    expect(rules(findings)).toEqual(["merged-migration-comment-only-edit"]);
    expect(hasErrors(findings)).toBe(false);
  });

  it("ignores whitespace-only reformatting of the SQL", () => {
    const findings = checkMigrations(
      input({
        baseNames: base,
        headNames: base,
        modified: [
          {
            name: "20260101000000_thing.sql",
            baseSql: "create table if not exists a (id int);",
            sql: "create table if not exists\n  a (id int);\n",
          },
        ],
      }),
    );
    expect(hasErrors(findings)).toBe(false);
  });

  it("says nothing when the file was added in this same change", () => {
    const findings = checkMigrations(
      input({
        baseNames: [],
        headNames: base,
        modified: [
          {
            name: "20260101000000_thing.sql",
            baseSql: "",
            sql: "create table if not exists a (id int);",
          },
        ],
      }),
    );
    expect(rules(findings)).toEqual([]);
  });
});

describe("checkMigrations: a merged migration must not be deleted", () => {
  it("errors, and explains that it blocks every later migration", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["20260101000000_thing.sql"],
        headNames: [],
        deleted: ["20260101000000_thing.sql"],
      }),
    );
    expect(rules(findings)).toEqual(["merged-migration-deleted"]);
    expect(findings[0].detail).toContain("refuses to run AT ALL");
  });

  it("says nothing when the deleted file was never on the base branch", () => {
    const findings = checkMigrations(
      input({ baseNames: [], headNames: [], deleted: ["20260101000000_scratch.sql"] }),
    );
    expect(rules(findings)).toEqual([]);
  });
});

describe("checkMigrations: names and versions", () => {
  const added = (name: string, sql = "select 1;") => ({ name, sql });

  it("requires the timestamped form for a new migration", () => {
    const findings = checkMigrations(
      input({ headNames: ["add_thing.sql"], added: [added("add_thing.sql")] }),
    );
    expect(rules(findings)).toEqual(["bad-filename"]);
  });

  it("rejects a four-digit name for a NEW migration while grandfathering existing ones", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["0001_init.sql", "0066_artifact_grounding.sql"],
        headNames: ["0001_init.sql", "0066_artifact_grounding.sql", "0067_new.sql"],
        added: [added("0067_new.sql")],
      }),
    );
    expect(rules(findings)).toEqual(["bad-filename"]);
  });

  it("rejects an upper-case or hyphenated name", () => {
    expect(
      rules(
        checkMigrations(
          input({ headNames: ["20260101000000_AddThing.sql"], added: [added("20260101000000_AddThing.sql")] }),
        ),
      ),
    ).toEqual(["bad-filename"]);
    expect(
      rules(
        checkMigrations(
          input({ headNames: ["20260101000000_add-thing.sql"], added: [added("20260101000000_add-thing.sql")] }),
        ),
      ),
    ).toEqual(["bad-filename"]);
  });

  it("rejects an impossible timestamp", () => {
    const findings = checkMigrations(
      input({ headNames: ["20261301000000_x.sql"], added: [added("20261301000000_x.sql")] }),
    );
    expect(rules(findings)).toEqual(["implausible-timestamp"]);
  });

  it("errors when a new version is already used on the base branch", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["20260101000000_original.sql"],
        headNames: ["20260101000000_original.sql", "20260101000000_different_name.sql"],
        added: [added("20260101000000_different_name.sql")],
      }),
    );
    expect(rules(findings)).toContain("version-collision");
    expect(rules(findings)).toContain("duplicate-version");
    expect(hasErrors(findings)).toBe(true);
  });

  it("errors on two new migrations sharing a version", () => {
    const findings = checkMigrations(
      input({
        headNames: ["20260101000000_a.sql", "20260101000000_b.sql"],
        added: [added("20260101000000_a.sql"), added("20260101000000_b.sql")],
      }),
    );
    expect(rules(findings)).toEqual(["duplicate-version"]);
    expect(findings[0].title).toContain("appears 2 times");
  });

  it("accepts a well-formed new migration with nothing else to say", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["20260101000000_old.sql"],
        headNames: ["20260101000000_old.sql", "20260102000000_new.sql"],
        added: [added("20260102000000_new.sql", "create table if not exists t (id int);")],
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe("checkMigrations: out-of-order versions", () => {
  it("warns but does not fail, because --include-all applies them anyway", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["20260601000000_later.sql"],
        headNames: ["20260601000000_later.sql", "20260101000000_earlier.sql"],
        added: [{ name: "20260101000000_earlier.sql", sql: "select 1;" }],
      }),
    );
    expect(rules(findings)).toEqual(["out-of-order-version"]);
    expect(hasErrors(findings)).toBe(false);
  });

  it("says nothing when the new version is the latest", () => {
    const findings = checkMigrations(
      input({
        baseNames: ["20260101000000_earlier.sql"],
        headNames: ["20260101000000_earlier.sql", "20260601000000_later.sql"],
        added: [{ name: "20260601000000_later.sql", sql: "select 1;" }],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("ignores the legacy four-digit block when finding the latest version", () => {
    expect(highestTimestampedVersion(["0066_x.sql", "20260101000000_y.sql"])).toBe(
      "20260101000000",
    );
    expect(highestTimestampedVersion(["0001_init.sql"])).toBeNull();
    expect(highestTimestampedVersion([])).toBeNull();
  });
});

describe("checkMigrations: nothing to check", () => {
  it("returns no findings for an empty change", () => {
    expect(checkMigrations(empty)).toEqual([]);
    expect(hasErrors([])).toBe(false);
  });
});
