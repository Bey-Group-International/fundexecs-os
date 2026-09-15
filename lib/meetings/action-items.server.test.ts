// lib/meetings/action-items.server.test.ts
// A commitment made in a meeting has to land on the list of the person who
// made it — and it has to land at all. Both were broken; both are tested here.
const createTeamTaskMock = jest.fn();

jest.mock("@/lib/team-tasks", () => ({
  createTeamTask: (...a: unknown[]) => createTeamTaskMock(...a),
}));

import { createActionItemTasks } from "./action-items.server";

const DIRECTORY = [
  { id: "p-sarah", name: "Sarah Chen", email: "sarah@fund.test" },
  { id: "p-mike", name: "Mike Alvarez", email: "mike@fund.test" },
];

const BASE = {
  orgId: "org-1",
  hostId: "p-host",
  meetingTitle: "Series B sync",
  directory: DIRECTORY,
};

beforeEach(() => {
  jest.clearAllMocks();
  createTeamTaskMock.mockImplementation(async () => ({ id: "task" }));
});

/** The input each createTeamTask call was made with. */
const calls = () => createTeamTaskMock.mock.calls.map((c) => c[1] as Record<string, unknown>);

describe("createActionItemTasks", () => {
  it("assigns an item to the person it names", async () => {
    await createActionItemTasks({} as never, { ...BASE, items: ["Sarah: Send the deck by Friday"] });
    expect(calls()[0].assignedTo).toBe("p-sarah");
    expect(calls()[0].assignedBy).toBe("p-host");
  });

  it("drops the owner prefix once the item has reached that person", async () => {
    await createActionItemTasks({} as never, { ...BASE, items: ["Sarah: Send the deck by Friday"] });
    expect(calls()[0].title).toBe("Send the deck by Friday");
  });

  it("leaves the owner on the title when the item falls back to the host", async () => {
    // Otherwise the host's list fills with commitments that read as nobody's.
    await createActionItemTasks({} as never, { ...BASE, items: ["Priya: Send the deck"] });
    expect(calls()[0].assignedTo).toBe("p-host");
    expect(calls()[0].title).toBe("Priya: Send the deck");
  });

  it("keeps an unowned item with the host", async () => {
    await createActionItemTasks({} as never, { ...BASE, items: ["Circulate the revised model"] });
    expect(calls()[0].assignedTo).toBe("p-host");
  });

  it("refuses to guess between two people with the same name", async () => {
    const twoSarahs = [
      { id: "p1", name: "Sarah Chen", email: "sarah@fund.test" },
      { id: "p2", name: "Sarah Okonkwo", email: "sokonkwo@fund.test" },
    ];
    const result = await createActionItemTasks({} as never, {
      ...BASE,
      directory: twoSarahs,
      items: ["Sarah: Send the deck"],
    });
    expect(calls()[0].assignedTo).toBe("p-host");
    expect(result.unrouted).toEqual(["Sarah"]);
  });

  it("keeps the item verbatim in the description, whatever the title had to drop", async () => {
    const long = "Sarah: " + "Send the updated cap table to every investor on the list ".repeat(5);
    await createActionItemTasks({} as never, { ...BASE, items: [long] });
    expect(String(calls()[0].description)).toContain("Send the updated cap table");
    expect(String(calls()[0].title).length).toBeLessThanOrEqual(120);
  });

  it("carries the deal and the summary onto every task", async () => {
    await createActionItemTasks({} as never, {
      ...BASE,
      dealId: "deal-9",
      summary: "We agreed terms.",
      items: ["Sarah: Send the deck", "Mike: Update the model"],
    });
    for (const call of calls()) {
      expect(call.dealId).toBe("deal-9");
      expect(call.contextSnapshot).toBe("We agreed terms.");
      expect(call.module).toBe("live_meetings");
    }
  });

  it("reports what it wrote and what it routed", async () => {
    const result = await createActionItemTasks({} as never, {
      ...BASE,
      items: ["Sarah: Send the deck", "Mike: Update the model", "Book the room"],
    });
    expect(result).toEqual({ created: 3, routed: 2, unrouted: [] });
  });

  // createTeamTask swallows its own failures and answers null. A report must
  // not fail because a task did, but the count must tell the truth.
  it("counts a task that could not be written as not written", async () => {
    createTeamTaskMock.mockImplementation(async () => null);
    const result = await createActionItemTasks({} as never, { ...BASE, items: ["Sarah: Send the deck"] });
    expect(result).toEqual({ created: 0, routed: 0, unrouted: [] });
  });

  it("does nothing, and asks for nothing, when there are no items", async () => {
    const result = await createActionItemTasks({} as never, { ...BASE, items: [] });
    expect(result).toEqual({ created: 0, routed: 0, unrouted: [] });
    expect(createTeamTaskMock).not.toHaveBeenCalled();
  });

  it("keeps everything with the host when the directory could not be loaded", async () => {
    // loadOrgDirectory fails closed and answers []. That must mean "assign to
    // the host", never "assign to whoever is left".
    await createActionItemTasks({} as never, { ...BASE, directory: [], items: ["Sarah: Send the deck"] });
    expect(calls()[0].assignedTo).toBe("p-host");
  });
});
