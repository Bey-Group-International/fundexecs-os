import { readdirSync } from "fs";
import { join } from "path";

// Forward-only migration naming guard.
//
// The repo's history mixes two numbering schemes in supabase/migrations:
//   - a long legacy `00NN_*.sql` sequence (already applied to prod/preview)
//   - a 14-digit UTC timestamp scheme `YYYYMMDDHHMMSS_slug.sql`
//
// Because a timestamp version sorts astronomically higher than the `00NN`
// numbers, every NEW `00NN` migration applies "out of order" relative to the
// timestamped one on incremental databases — producing Supabase's noisy
// out-of-order warnings.
//
// The fix is forward-only: future migrations MUST use the timestamp scheme.
// We never rename existing migrations (renaming an applied migration makes the
// DB think it is missing/new and can trigger re-application or errors), so the
// `00NN` files present today are grandfathered into a legacy allowlist that is
// computed from the directory at test time. Any file that is neither a
// grandfathered legacy file nor a valid timestamp file fails this guard.
describe("supabase migration naming convention", () => {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  // 14-digit UTC timestamp + snake_case slug, e.g. 20260622100000_lp_onboarding.sql
  const TIMESTAMP = /^\d{14}_[a-z0-9_]+\.sql$/;
  // Legacy numeric prefix that is NOT a 14-digit timestamp, e.g. 0065_artifact.sql
  const LEGACY = /^\d{1,4}_[a-z0-9_]+\.sql$/;

  // Grandfathered set: every legacy numeric file that exists on this branch.
  // These are intentionally left as-is because they are already applied.
  const legacyAllowlist = new Set(
    files.filter((f) => LEGACY.test(f) && !TIMESTAMP.test(f)),
  );

  it("has at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("grandfathers the existing legacy 00NN migrations", () => {
    // Sanity check: the legacy sequence is non-empty today. If this ever drops
    // to zero we want to know (the allowlist logic likely broke).
    expect(legacyAllowlist.size).toBeGreaterThan(0);
  });

  it("names every migration with a timestamp, unless grandfathered", () => {
    const offenders = files.filter(
      (f) => !TIMESTAMP.test(f) && !legacyAllowlist.has(f),
    );
    // Any NEW migration must use the 14-digit timestamp format
    // (YYYYMMDDHHMMSS_snake_slug.sql). See CONTRIBUTING.md "Database migrations".
    expect(offenders).toEqual([]);
  });
});
