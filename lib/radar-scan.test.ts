// lib/radar-scan.test.ts
// Unit tests for the PURE staleness + org-selection helpers that decide which
// organizations the scheduled radar scan tops up each sweep. No DB, no key.
import { __test } from "@/lib/radar-scan";

const { isOrgScanDue, selectDueOrgs, MAX_ORGS_PER_SWEEP } = __test;

const NOW = new Date("2026-06-22T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

describe("isOrgScanDue (once-per-day guard)", () => {
  it("treats a never-scanned org as due", () => {
    expect(isOrgScanDue(null, NOW)).toBe(true);
    expect(isOrgScanDue(undefined, NOW)).toBe(true);
    expect(isOrgScanDue("", NOW)).toBe(true);
  });
  it("treats an unparseable timestamp as due", () => {
    expect(isOrgScanDue("not-a-date", NOW)).toBe(true);
  });
  it("is NOT due within the min interval", () => {
    expect(isOrgScanDue(hoursAgo(1), NOW)).toBe(false);
    expect(isOrgScanDue(hoursAgo(23), NOW)).toBe(false);
  });
  it("is due once the most recent signal is older than the interval", () => {
    expect(isOrgScanDue(hoursAgo(24), NOW)).toBe(true);
    expect(isOrgScanDue(hoursAgo(48), NOW)).toBe(true);
  });
  it("respects a custom interval", () => {
    expect(isOrgScanDue(hoursAgo(2), NOW, 1)).toBe(true);
    expect(isOrgScanDue(hoursAgo(2), NOW, 6)).toBe(false);
  });
});

describe("selectDueOrgs", () => {
  it("returns only due orgs, never-scanned and stale ones", () => {
    const due = selectDueOrgs(
      [
        { orgId: "fresh", lastSignalAt: hoursAgo(2) }, // not due
        { orgId: "stale", lastSignalAt: hoursAgo(50) }, // due
        { orgId: "never", lastSignalAt: null }, // due
      ],
      NOW,
    );
    expect(due).toContain("stale");
    expect(due).toContain("never");
    expect(due).not.toContain("fresh");
  });

  it("orders never-scanned first, then oldest signal first", () => {
    const due = selectDueOrgs(
      [
        { orgId: "old", lastSignalAt: hoursAgo(30) },
        { orgId: "older", lastSignalAt: hoursAgo(100) },
        { orgId: "never", lastSignalAt: null },
      ],
      NOW,
    );
    expect(due).toEqual(["never", "older", "old"]);
  });

  it("caps the number of orgs per sweep (default MAX_ORGS_PER_SWEEP)", () => {
    const orgs = Array.from({ length: MAX_ORGS_PER_SWEEP + 4 }, (_, i) => ({
      orgId: `org-${i}`,
      lastSignalAt: null,
    }));
    expect(selectDueOrgs(orgs, NOW).length).toBe(MAX_ORGS_PER_SWEEP);
  });

  it("honors an explicit max cap", () => {
    const orgs = Array.from({ length: 10 }, (_, i) => ({ orgId: `o${i}`, lastSignalAt: null }));
    expect(selectDueOrgs(orgs, NOW, { max: 2 }).length).toBe(2);
  });

  it("drops blank org ids", () => {
    const due = selectDueOrgs(
      [
        { orgId: "", lastSignalAt: null },
        { orgId: "real", lastSignalAt: null },
      ],
      NOW,
    );
    expect(due).toEqual(["real"]);
  });

  it("returns [] when nothing is due", () => {
    expect(
      selectDueOrgs([{ orgId: "fresh", lastSignalAt: hoursAgo(1) }], NOW),
    ).toEqual([]);
  });
});
