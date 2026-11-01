jest.mock("server-only", () => ({}), { virtual: true });

import { createHash } from "node:crypto";
import { MIN_SDN_ROWS, SCREEN_PREFIX } from "./ofac";
import { loadSdnIndex, resetSdnCache, runOfacScreen, subjectsFor } from "./ofac.server";

const row = (id: number, name: string, type = "-0- ", program = "SDGT") => `${id},"${name}","${type}","${program}","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- "`;
const SDN = [row(1, "AEROCARIBBEAN AIRLINES", "-0- ", "CUBA"), ...Array.from({ length: MIN_SDN_ROWS }, (_, i) => row(1000 + i, `ZZQ${i}X VRNT${i}Y`))].join("\r\n") + "\r\n\u001a";
const ALT = `1,1,"aka","AERO-CARIBBEAN","-0- "\r\n`;

const NOW = Date.parse("2026-11-01T12:00:00Z");
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

let fetched: string[] = [];
let sdnResponse: { ok: boolean; status: number; text: string; modified?: string } = { ok: true, status: 200, text: SDN, modified: "Thu, 30 Oct 2026 15:00:00 GMT" };
let altResponse: { ok: boolean; status: number; text: string } = { ok: true, status: 200, text: ALT };
const fetchMock = jest.fn(async (url: string) => {
  fetched.push(url);
  const r = url.endsWith("sdn.csv") ? sdnResponse : altResponse;
  return { ok: r.ok, status: r.status, text: async () => r.text, headers: { get: (h: string) => (h.toLowerCase() === "last-modified" ? ("modified" in r ? (r as { modified?: string }).modified ?? null : null) : null) } };
});

// A fake database: three tables, with a log of writes.
let tables: Record<string, unknown>;
let writes: Array<{ table: string; op: string; row: Record<string, unknown>; filters: Record<string, unknown> }>;
let writeError: { code: string; message: string } | null;
let checkReads: Array<Record<string, unknown>>;
// Audit rows are kept apart, so assertions about the check row stay about the check row.
let audits: Array<Record<string, unknown>>;
const client = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let op = "select";
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      update: (row: Record<string, unknown>) => ((op = "update"), writes.push({ table, op, row, filters }), q),
      insert: (row: Record<string, unknown>) => {
        op = "insert";
        if (table === "onboarding_audit_log") audits.push(row);
        else writes.push({ table, op, row, filters });
        return q;
      },
      maybeSingle: async () => {
        if (table === "onboarding_checks") checkReads.push({ ...filters });
        return { data: (tables[table] as unknown) ?? null };
      },
      then: (resolve: (v: unknown) => void) => resolve(op === "select" ? { data: tables[table] ?? [], error: null } : { error: writeError }),
    };
    return q;
  },
} as never;

beforeEach(() => {
  resetSdnCache();
  fetched = [];
  sdnResponse = { ok: true, status: 200, text: SDN, modified: "Thu, 30 Oct 2026 15:00:00 GMT" };
  altResponse = { ok: true, status: 200, text: ALT };
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  tables = {
    lp_onboarding_sessions: { lp_name: "Jane Doe" },
    lp_onboarding_profiles: { legal_name: "Jane Doe", signatory_name: null },
    lp_onboarding_owners: [],
    onboarding_checks: null,
  };
  writes = [];
  audits = [];
  checkReads = [];
  writeError = null;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("loadSdnIndex", () => {
  it("downloads both files from Treasury, and dates the list by Last-Modified", async () => {
    const idx = await loadSdnIndex(NOW);
    expect(fetched.sort()).toEqual(["https://www.treasury.gov/ofac/downloads/alt.csv", "https://www.treasury.gov/ofac/downloads/sdn.csv"]);
    expect(idx.listDate).toBe("2026-10-30");
    expect(idx.entries.length).toBe(MIN_SDN_ROWS + 1);
  });

  it("falls back to today's date when there is no Last-Modified", async () => {
    sdnResponse = { ...sdnResponse, modified: undefined };
    expect((await loadSdnIndex(NOW)).listDate).toBe("2026-11-01");
  });

  it("fingerprints exactly the two files it matched against", async () => {
    const idx = await loadSdnIndex(NOW);
    expect(idx.source).toEqual({ sdnSha256: sha(SDN), altSha256: sha(ALT), dateBasis: "last_modified" });
    expect(idx.source!.sdnSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a different fingerprint when the list changes, and says when the date is only the day it was fetched", async () => {
    const a = await loadSdnIndex(NOW);
    resetSdnCache();
    sdnResponse = { ...sdnResponse, text: SDN + "\r\n" + row(99999, "NEW ENTRY ONE"), modified: undefined };
    const b = await loadSdnIndex(NOW);
    expect(b.source!.sdnSha256).not.toBe(a.source!.sdnSha256);
    expect(b.source!.altSha256).toBe(a.source!.altSha256);
    expect(b.source!.dateBasis).toBe("fetched");
  });

  it("keeps the list for a few hours, then downloads again", async () => {
    await loadSdnIndex(NOW);
    await loadSdnIndex(NOW + 3600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await loadSdnIndex(NOW + 7 * 3600_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails on a bad response or a file that isn't the list, rather than carrying on", async () => {
    sdnResponse = { ok: false, status: 503, text: "" };
    await expect(loadSdnIndex(NOW)).rejects.toThrow(/503/);
    sdnResponse = { ok: true, status: 200, text: "<html>Access denied</html>" };
    await expect(loadSdnIndex(NOW)).rejects.toThrow(/looks wrong/);
    altResponse = { ok: false, status: 500, text: "" };
    sdnResponse = { ok: true, status: 200, text: SDN };
    await expect(loadSdnIndex(NOW)).rejects.toThrow(/500/);
  });
});

describe("subjectsFor", () => {
  it("lists the LP, the signatory, and every owner and controller, scoped to the organization", async () => {
    tables.lp_onboarding_profiles = { legal_name: " Acme Trust ", signatory_name: "Jo Park" };
    tables.lp_onboarding_owners = [
      { full_name: "Sam Lee", role: "owner" },
      { full_name: "Ana Ruiz", role: "controller" },
    ];
    expect(await subjectsFor(client, "s1", "org-1")).toEqual([
      { role: "the LP", name: "Acme Trust" },
      { role: "signatory", name: "Jo Park" },
      { role: "owner", name: "Sam Lee" },
      { role: "controller", name: "Ana Ruiz" },
    ]);
  });

  it("uses the name on the invitation until the LP gives a legal name", async () => {
    tables.lp_onboarding_profiles = null;
    expect(await subjectsFor(client, "s1", "org-1")).toEqual([{ role: "the LP", name: "Jane Doe" }]);
  });

  it("returns nothing for an LP outside the organization", async () => {
    tables.lp_onboarding_sessions = null;
    expect(await subjectsFor(client, "s-other", "org-1")).toEqual([]);
  });
});

describe("runOfacScreen", () => {
  it("leaves the sanctions check pending, with a note, when nothing matches", async () => {
    const res = await runOfacScreen(client, "s1", "org-1", { now: NOW });
    expect(res).toMatchObject({ ok: true, flagged: 0, screened: 1, wrote: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "onboarding_checks", op: "insert", row: { kind: "sanctions", status: "pending", organization_id: "org-1", session_id: "s1", recorded_by: null, checked_at: null } });
    expect(String(writes[0].row.summary)).toContain("Not a clearance");
  });

  describe("the audit trail", () => {
    it("records a run that wrote, as the system's by default, with the outcome and the list it used", async () => {
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(audits).toEqual([
        {
          organization_id: "org-1",
          session_id: "s1",
          actor_id: null,
          actor_kind: "system",
          action: "check.screen_run",
          detail: {
            status: "pending",
            matches: 0,
            screened: 1,
            wrote: true,
            list_date: "2026-10-30",
            list_size: MIN_SDN_ROWS + 1,
            date_basis: "last_modified",
            sdn_sha256: sha(SDN),
            alt_sha256: sha(ALT),
          },
        },
      ]);
    });

    it("records a re-run by a fund manager under their id", async () => {
      await runOfacScreen(client, "s1", "org-1", { now: NOW, actor: { kind: "user", id: "user-7" } });
      expect(audits[0]).toMatchObject({ actor_id: "user-7", actor_kind: "user", action: "check.screen_run" });
    });

    it("records a re-run that changed nothing, because a person's result was left alone", async () => {
      tables.onboarding_checks = { status: "clear", summary: "Checked Dow Jones", recorded_by: "user-1" };
      tables.lp_onboarding_profiles = { legal_name: "Aerocaribbean Airlines", signatory_name: null };
      await runOfacScreen(client, "s1", "org-1", { now: NOW, actor: { kind: "user", id: "user-7" } });
      expect(writes).toEqual([]);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actor_id: "user-7", detail: { status: "flagged", matches: 1, wrote: false } });
    });

    it("records nothing for a run that failed before it screened anything", async () => {
      sdnResponse = { ok: false, status: 503, text: "" };
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      tables.lp_onboarding_sessions = null;
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(audits).toEqual([]);
    });

    it("records nothing for a run whose result could not be saved", async () => {
      writeError = { code: "42501", message: "denied" };
      const res = await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(res.ok).toBe(false);
      expect(audits).toEqual([]);
    });
  });

  it("flags a possible match, which blocks approval until a person records a result", async () => {
    tables.lp_onboarding_profiles = { legal_name: "Aerocaribbean Airlines", signatory_name: null };
    const res = await runOfacScreen(client, "s1", "org-1", { now: NOW });
    expect(res).toMatchObject({ ok: true, flagged: 1, wrote: true });
    expect(writes[0].row).toMatchObject({ status: "flagged", checked_at: new Date(NOW).toISOString() });
    expect(String(writes[0].row.summary)).toContain("resembles AEROCARIBBEAN AIRLINES [CUBA]");
  });

  it("reads the existing check for this LP in this organization only", async () => {
    await runOfacScreen(client, "s1", "org-1", { now: NOW });
    expect(checkReads).toEqual([{ session_id: "s1", organization_id: "org-1", kind: "sanctions" }]);
  });

  it("never writes a clear status", async () => {
    await runOfacScreen(client, "s1", "org-1", { now: NOW });
    tables.lp_onboarding_profiles = { legal_name: "Aerocaribbean Airlines", signatory_name: null };
    await runOfacScreen(client, "s1", "org-1", { now: NOW });
    expect(writes.every((w) => w.row.status !== "clear")).toBe(true);
  });

  describe("an existing sanctions check", () => {
    const existing = (over: Record<string, unknown>) => {
      tables.onboarding_checks = { status: "pending", summary: null, recorded_by: null, ...over };
    };

    it.each([
      ["clear by a person", { status: "clear", summary: "Checked Dow Jones", recorded_by: "user-1" }],
      ["failed by a person", { status: "failed", summary: "On the list", recorded_by: "user-1" }],
      ["flagged by a person", { status: "flagged", summary: "Looking into it", recorded_by: "user-1" }],
      ["pending with a person's note", { status: "pending", summary: "Waiting on documents", recorded_by: "user-1" }],
      ["pending with a note and no author", { status: "pending", summary: "Some other note" }],
    ])("leaves a check that is %s alone", async (_n, over) => {
      existing(over);
      tables.lp_onboarding_profiles = { legal_name: "Aerocaribbean Airlines", signatory_name: null };
      const res = await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(res).toMatchObject({ ok: true, flagged: 1, wrote: false });
      expect(writes).toEqual([]);
    });

    it("replaces a pending placeholder with no note", async () => {
      existing({ status: "pending", summary: "" });
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(writes[0]).toMatchObject({ op: "update", filters: { session_id: "s1", organization_id: "org-1", kind: "sanctions", status: "pending" } });
    });

    it("refreshes a result this screen wrote earlier, flagged or not", async () => {
      existing({ status: "flagged", summary: `${SCREEN_PREFIX} 2026-10-01: possible match.`, recorded_by: null });
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(writes[0]).toMatchObject({ op: "update", row: { status: "pending" }, filters: { status: "flagged" } });
      writes = [];
      existing({ status: "pending", summary: `${SCREEN_PREFIX} 2026-10-01: no possible match.`, recorded_by: null });
      await runOfacScreen(client, "s1", "org-1", { now: NOW });
      expect(writes[0]).toMatchObject({ op: "update" });
    });
  });

  it("writes nothing, and says why, when OFAC's list can't be fetched", async () => {
    sdnResponse = { ok: false, status: 503, text: "" };
    const res = await runOfacScreen(client, "s1", "org-1", { now: NOW });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("Couldn't get OFAC's list") });
    expect(writes).toEqual([]);
  });

  it("writes nothing when the download isn't the real list", async () => {
    sdnResponse = { ok: true, status: 200, text: "<html>Blocked</html>" };
    expect((await runOfacScreen(client, "s1", "org-1", { now: NOW })).ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses an LP that isn't this organization's", async () => {
    tables.lp_onboarding_sessions = null;
    expect(await runOfacScreen(client, "s-other", "org-1", { now: NOW })).toEqual({ ok: false, error: "That LP wasn't found." });
    expect(writes).toEqual([]);
  });

  it("hides a database error", async () => {
    writeError = { code: "42501", message: "rls" };
    expect(await runOfacScreen(client, "s1", "org-1", { now: NOW })).toEqual({ ok: false, error: "Couldn't save the screen. Try again." });
  });
});
