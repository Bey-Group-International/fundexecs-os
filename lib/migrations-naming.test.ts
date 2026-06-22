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
// out-of-order warnings, and (worse) two branches independently picking the same
// next `00NN` collide on a duplicate version, which silently skips one migration.
//
// The fix is forward-only: future migrations MUST use the timestamp scheme.
// We never rename existing migrations (renaming an applied migration makes the
// DB think it is missing/new and can trigger re-application or errors), so the
// legacy `00NN` files are grandfathered — but by a FIXED numeric cutoff, not by
// "whatever happens to be on disk." A dynamic allowlist (readdirSync-derived)
// would auto-grandfather any new `00NN` file too, making the guard a no-op; the
// cutoff is what actually forces new migrations onto the timestamp scheme.
//
// LEGACY_MAX is the highest legacy `00NN` migration that existed when the
// timestamp convention was adopted. Do NOT raise it — new migrations must use
// `YYYYMMDDHHMMSS_snake_slug.sql`. See CONTRIBUTING.md "Database migrations".
const LEGACY_MAX = 66;

describe("supabase migration naming convention", () => {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  // 14-digit UTC timestamp + snake_case slug, e.g. 20260622100000_lp_onboarding.sql
  const TIMESTAMP = /^\d{14}_[a-z0-9_]+\.sql$/;
  // Legacy numeric prefix (1–4 digits) that is NOT a 14-digit timestamp,
  // capturing the number, e.g. 0066_artifact_grounding.sql -> 66
  const LEGACY = /^(\d{1,4})_[a-z0-9_]+\.sql$/;

  // A file is acceptable iff it is a valid timestamp migration OR a grandfathered
  // legacy migration (`00NN` with N <= LEGACY_MAX). Anything else — a new `00NN`
  // above the cutoff, or a malformed name — is an offender.
  const isGrandfatheredLegacy = (f: string): boolean => {
    const m = f.match(LEGACY);
    return m !== null && Number(m[1]) <= LEGACY_MAX;
  };

  it("has at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("still contains the grandfathered legacy 00NN migrations", () => {
    // Sanity check: the legacy sequence is non-empty today. If this ever drops
    // to zero something is wrong (the migrations dir moved, or the cutoff broke).
    expect(files.some(isGrandfatheredLegacy)).toBe(true);
  });

  it("names every NEW migration with a 14-digit timestamp", () => {
    const offenders = files.filter(
      (f) => !TIMESTAMP.test(f) && !isGrandfatheredLegacy(f),
    );
    // Any migration that is not grandfathered legacy (00NN <= LEGACY_MAX) MUST
    // use the 14-digit timestamp format (YYYYMMDDHHMMSS_snake_slug.sql). A new
    // `00NN` file fails here on purpose — see CONTRIBUTING.md "Database
    // migrations" for why (out-of-order warnings + duplicate-prefix collisions).
    expect(offenders).toEqual([]);
  });
});
