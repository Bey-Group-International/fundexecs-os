import { loadNotetakerForReport, readLiveNotes } from "./notetaker.server";
import { reportPrompt } from "./report-analysis";

function db(tables: Record<string, { data: unknown; error?: unknown }>) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) q[m] = () => q;
      q.maybeSingle = async () => tables[table] ?? { data: null, error: null };
      q.then = (resolve: (v: unknown) => unknown) => resolve(tables[table] ?? { data: null, error: null });
      return q;
    },
  };
}

const MEETING = { id: "m1", host_id: "h1", organization_id: "o1", started_at: "2026-11-06T10:00:00Z" };

it("gathers the glossary, the host's notes and the bookmarks for the report", async () => {
  const out = await loadNotetakerForReport(
    db({
      meeting_glossary_terms: { data: [{ term: "LPAC" }] },
      live_meeting_notes: { data: { body: "Ana owns the model" } },
      live_meeting_bookmarks: { data: [{ id: "b1", at: "2026-11-06T10:05:00Z", label: "Fees", user_id: "h1" }] },
      principals: { data: [{ id: "h1", full_name: "Hana Host" }] },
    }) as never,
    MEETING,
  );
  expect(out.glossary).toEqual(["LPAC"]);
  expect(out.text).toContain("spell them exactly so): LPAC");
  expect(out.text).toContain("Ana owns the model");
  expect(out.text).toContain("- 5:00 (Hana Host): Fees");
});

it("leaves out whatever cannot be read", async () => {
  const out = await loadNotetakerForReport(
    db({
      meeting_glossary_terms: { data: null, error: { code: "42P01" } },
      live_meeting_notes: { data: null, error: { code: "42P01" } },
      live_meeting_bookmarks: { data: null, error: { code: "42P01" } },
    }) as never,
    MEETING,
  );
  expect(out).toEqual({ text: "", glossary: [] });
});

it("reads stored live notes defensively", () => {
  expect(readLiveNotes(null).lines).toBe(0);
  const notes = readLiveNotes({ summary: "S", key_points: [{ text: "object point" }], generatedAt: 5, lines: 3.7 });
  expect(notes.key_points).toEqual(["object point"]);
  expect(notes.lines).toBe(3);
  expect(notes.generatedAt).toBe(5);
});

it("puts the notetaker's context in the report prompt, before the transcript", () => {
  const prompt = reportPrompt({ title: "Call", participants: ["Ana"], transcript: "Ana: hi", notetaker: "Names and terms: LPAC" });
  expect(prompt).toContain("FROM THE NOTETAKER (gathered during the meeting):\nNames and terms: LPAC");
  expect(prompt.indexOf("FROM THE NOTETAKER")).toBeLessThan(prompt.indexOf("FULL TRANSCRIPT"));
  expect(reportPrompt({ title: "Call", participants: [], transcript: "x" })).not.toContain("FROM THE NOTETAKER");
});
