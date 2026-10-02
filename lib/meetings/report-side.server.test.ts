import { loadReportSide } from "@/lib/meetings/report-side.server";

type Rows = Record<string, unknown>;

function client(tables: Rows, failing: string[] = []) {
  return {
    from: (table: string) => {
      if (failing.includes(table)) throw new Error(`${table} unavailable`);
      const data = tables[table];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error: null }).then(resolve),
      };
      return b;
    },
  } as never;
}

const input = { meetingId: "m1", hostId: "host-1", invited: [{ name: "Jane", email: "jane@lp.test" }], hasFollowUp: true };

it("gathers the people, the follow-up state and the tasks", async () => {
  const side = await loadReportSide(
    client({
      principals: [{ id: "u1", full_name: "Alex Rivera", email: "alex@fund.test" }],
      live_meeting_participants: [],
      live_meetings: { followup_status: "draft" },
      inbox_thread_drafts: [{ thread_id: "th1" }],
      team_tasks: [{ id: "t1", title: "x", status: "pending", due_at: null, assigned_to: "u1", context_snapshot: { action_item: "Jane: x" } }],
    }),
    input,
  );
  expect(side.participants.map((p) => p.role)).toEqual(["host", "invitee"]);
  expect(side.followUp).toEqual({ kind: "drafted", threads: 1 });
  expect(side.tasks[0]).toMatchObject({ id: "t1", actionItem: "Jane: x" });
});

it("never fails the page when a read does", async () => {
  const side = await loadReportSide(client({}, ["team_tasks", "inbox_thread_drafts", "live_meetings"]), input);
  expect(side.tasks).toEqual([]);
  expect(side.followUp).toEqual({ kind: "not_sent" });
});

/**
 * `live_meeting_participants` cannot hold an unauthenticated guest -- its RLS
 * is `user_id = auth.uid()` -- so an invitee who opened the link without
 * signing in left no attendance row and the page reported them absent. The
 * transcript is where they survive, and the page already has those rows.
 */
it("counts a guest the attendance table could not hold", async () => {
  const tables = {
    principals: [{ id: "host-1", full_name: "Alex Rivera", email: "alex@fund.test" }],
    live_meeting_participants: [],
    live_meetings: { followup_status: "draft" },
    inbox_thread_drafts: [],
    team_tasks: [],
  };

  const without = await loadReportSide(client(tables), input);
  // Without the transcript there is nobody in the room, so attendance is
  // unknown rather than absent -- never a claim that she did not join.
  expect(without.participants.find((p) => p.email === "jane@lp.test")?.attended).toBeNull();

  const with_ = await loadReportSide(client(tables), {
    ...input,
    spoke: [{ name: "Jane", email: null }],
  });
  expect(with_.participants.find((p) => p.email === "jane@lp.test")).toMatchObject({
    role: "invitee",
    attended: true,
  });
  // Once, as the invitee she is -- not again as an anonymous attendee.
  expect(with_.participants.filter((p) => p.name === "Jane")).toHaveLength(1);
});
