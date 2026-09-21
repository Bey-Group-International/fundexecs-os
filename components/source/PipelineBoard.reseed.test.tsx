// The one race this board cannot reason its way out of.
//
// A drag is optimistic, so the header is adjusted by a delta until the server's
// rollup catches up. That delta must be dropped exactly when the rollup starts
// including the move — no sooner, or the header under-counts; no later, or it
// counts twice. The board has no version on the server's payload to tell it
// which side of the write a given snapshot falls on.
//
// Three rounds of review were spent guessing. The guess that survived longest
// was "a newer prop identity means the snapshot contains the move", and this
// file exists because that is false: a refresh fired by an unrelated action can
// query BEFORE the patch commits.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PipelineBoard, type StageSummary } from "./PipelineBoard";
import type { Opportunity } from "@/lib/network-opportunities";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: (...a: unknown[]) => refresh(...(a as [])) }),
}));

function deal(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "d1",
    name: "Fund III — Meridian",
    stage: "diligence",
    status: "open",
    contactId: null,
    contactName: null,
    investorId: null,
    fundId: null,
    fundName: null,
    targetAmount: 10_000_000,
    currency: "USD",
    probability: 50,
    weightedAmount: 5_000_000,
    expectedClose: null,
    closedAt: null,
    lostReason: null,
    commitmentId: null,
    ownerId: null,
    ownerName: null,
    source: null,
    notes: null,
    tags: [],
    custom: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    ...over,
  };
}

const summary: StageSummary[] = [
  { stage: "diligence", currency: "USD", dealCount: 1, targetTotal: 10_000_000, weightedTotal: 5_000_000 },
];

const realFetch = global.fetch;
function stubFetch(impl: () => Promise<Response>) {
  (global as { fetch?: unknown }).fetch = jest.fn(impl);
}

beforeEach(() => {
  refresh.mockReset();
});
afterEach(() => {
  (global as { fetch?: unknown }).fetch = realFetch;
});

describe("PipelineBoard — a move that outlives the snapshot it started in", () => {
  it("applies the server's row even when an unrelated refresh commits first", async () => {
    // The patch is held open so a refresh can land in the middle of it.
    let settle: (v: unknown) => void = () => {};
    const inFlight = new Promise((r) => {
      settle = r;
    });
    const moved = deal({
      stage: "legal",
      probability: 75,
      weightedAmount: 7_500_000,
      // The server stamps a new updated_at on every write; that is the version
      // the board uses to tell a stale snapshot from one that contains it.
      updatedAt: "2026-09-19T12:00:00.000Z",
    });

    stubFetch(async () => {
      await inFlight;
      return { ok: true, json: async () => ({ opportunity: moved }) } as Response;
    });

    const before = [deal()];
    const { rerender } = render(
      <PipelineBoard initialOpportunities={before} initialSummary={summary} />,
    );

    // Start the move. The board is optimistic, so the card leaves `diligence`
    // immediately; the request has not resolved.
    const select = screen.getByLabelText(/move .* to another stage/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "legal" } });

    // A DIFFERENT action refreshes the page — creating an allocation, say. Its
    // query ran before our patch committed, so the row it carries is still at
    // the old stage. This is a new array, so the board re-seeds from it.
    const stale = [deal()];
    rerender(<PipelineBoard initialOpportunities={stale} initialSummary={summary} />);

    // Now the patch returns. The snapshot on screen predates it.
    settle(null);

    // The server's row must win. Skipping it here — which the previous guard
    // did, on the strength of the prop identity having changed — left the board
    // showing `diligence` for a deal the server had already moved to `legal`.
    // The select mirrors `deal.stage`, so it says which stage the board holds.
    // Wait for the continuation, then read the board once. The select mirrors
    // `deal.stage`, so it says which stage the board is actually holding.
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // The server's row must win: the snapshot on screen is demonstrably older
    // than the write, by its own updated_at. Deciding this by arrival order is
    // what left the board showing `diligence` for a deal already at `legal`.
    const stages = screen
      .getAllByLabelText(/move .* to another stage/i)
      .map((el) => (el as HTMLSelectElement).value);
    expect(stages).toEqual(["legal"]);
  });

  it("asks for a snapshot taken after the commit, not before", async () => {
    const moved = deal({ stage: "legal", updatedAt: "2026-09-19T12:00:00.000Z" });
    stubFetch(async () => ({ ok: true, json: async () => ({ opportunity: moved }) }) as Response);

    render(<PipelineBoard initialOpportunities={[deal()]} initialSummary={summary} />);
    const select = screen.getByLabelText(/move .* to another stage/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "legal" } });

    // The refresh is the whole mechanism: only a read issued once the patch has
    // returned is guaranteed to contain it, and the re-seed drops the delta
    // when that page lands.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("does not refresh when the move fails", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({ error: "nope" }) }) as Response);

    render(<PipelineBoard initialOpportunities={[deal()]} initialSummary={summary} />);
    const select = screen.getByLabelText(/move .* to another stage/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "legal" } });

    await waitFor(() => expect(screen.getByText(/nope/i)).toBeInTheDocument());
    // Nothing committed, so there is no newer truth to go and fetch.
    expect(refresh).not.toHaveBeenCalled();
  });
});
