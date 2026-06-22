import { readdirSync } from "fs";
import { join } from "path";

// Guard against duplicate migration versions. Supabase keys schema_migrations by
// the leading numeric prefix of each filename, so two files sharing a prefix
// (e.g. two "0044_*.sql") collide on apply:
//   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
// This has bitten repeatedly when parallel branches each grab the next number.
// Fail fast in CI instead of at deploy time.
describe("supabase migrations", () => {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("has at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("assigns every migration a unique version prefix", () => {
    const byVersion = new Map<string, string[]>();
    for (const file of files) {
      const match = /^(\d+)_/.exec(file);
      expect(match).not.toBeNull();
      const version = match![1];
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }

    const duplicates = [...byVersion.entries()].filter(([, group]) => group.length > 1);
    expect(duplicates).toEqual([]);
  });

  it("names every migration <digits>_<slug>.sql", () => {
    const bad = files.filter((f) => !/^\d+_[a-z0-9_]+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });
});
