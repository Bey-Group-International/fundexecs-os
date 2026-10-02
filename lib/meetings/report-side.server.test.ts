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
