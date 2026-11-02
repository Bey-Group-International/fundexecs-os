jest.mock("@/components/dataroom/DataRoomViewer", () => ({
  // A stand-in that shows what the preview hands the viewer.
  DataRoomViewer: (p: {
    thesis: { title: string } | null;
    blended: { dealCount: number };
    team: unknown[];
    entities: unknown[];
    docSections: { key: string }[];
    focusDocumentId: string | null;
    compact?: boolean;
  }) => (
    <div
      data-testid="viewer"
      data-thesis={p.thesis?.title ?? ""}
      data-deals={p.blended.dealCount}
      data-team={p.team.length}
      data-entities={p.entities.length}
      data-sections={p.docSections.map((s) => s.key).join(",")}
      data-focus={p.focusDocumentId ?? ""}
      data-compact={String(p.compact ?? false)}
    />
  ),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoomPreview, type PreviewPayload, type PreviewShare } from "./RoomPreview";

const payload: PreviewPayload = {
  room: { name: "Fund III Raise", welcomeNote: null },
  org: { name: "Alpha", tagline: null, legal_name: null, entity_type: null, jurisdiction: null, website: null, brand_color: null, logo_url: null },
  blended: { dealCount: 3, realizedCount: 1, weightedGrossIrr: 20, pooledMoic: 2, dpi: 1, totalInvested: 100, vintageRange: null },
  thesis: { title: "Credit", summary: null, asset_classes: null, geographies: null, target_irr: null, target_moic: null, check_size_min: null, check_size_max: null },
  team: [{ name: "Pat", title: null, email: null }],
  entities: [{ name: "Fund I", entity_type: null }],
  docSections: [
    { key: "marketing", label: "Marketing", docs: [{ id: "m1", name: "Deck", content: "x", hasFile: false, doc_type: "marketing" }] },
    { key: "thesis", label: "Thesis", docs: [{ id: "t1", name: "Memo", content: "x", hasFile: false, doc_type: "thesis" }] },
  ],
};

const SHARES: PreviewShare[] = [
  { id: "s-all", label: "Everyone", allowedSections: null, gates: [] },
  { id: "s-mkt", label: "Marketing only", allowedSections: ["marketing"], gates: ["email"] },
];

const viewer = () => screen.getByTestId("viewer");

function setup(over: Partial<React.ComponentProps<typeof RoomPreview>> = {}) {
  const loadPreview = jest.fn(async () => payload);
  const utils = render(<RoomPreview roomId="r1" shares={SHARES} active={false} loadPreview={loadPreview} {...over} />);
  return { loadPreview, ...utils };
}

describe("loading", () => {
  it("does not build the preview while the pane is closed", () => {
    const { loadPreview } = setup();
    expect(loadPreview).not.toHaveBeenCalled();
  });

  it("loads when the pane opens, and again each time it reopens", async () => {
    const { loadPreview, rerender } = setup({ active: true });
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    expect(loadPreview).toHaveBeenCalledTimes(1);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active={false} loadPreview={loadPreview} />);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(2));
  });

  it("says so when the preview cannot be built", async () => {
    setup({ active: true, loadPreview: jest.fn(async () => null) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable."));
  });

  it("says so when loading throws", async () => {
    setup({ active: true, loadPreview: jest.fn(async () => { throw new Error("redacted"); }) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable."));
  });

  it("drops a late answer to an earlier opening", async () => {
    let first!: (v: PreviewPayload | null) => void;
    const loadPreview = jest
      .fn<Promise<PreviewPayload | null>, []>()
      .mockImplementationOnce(() => new Promise((r) => (first = r)))
      .mockImplementationOnce(async () => payload);
    const { rerender } = render(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active={false} loadPreview={loadPreview} />);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    await act(async () => first(null));
    // The stale "unavailable" answer must not replace the newer payload.
    expect(viewer()).toBeInTheDocument();
  });
});

describe("scoping to a link", () => {
  it("shows everything for anyone with full access", async () => {
    setup({ active: true });
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    expect(viewer()).toHaveAttribute("data-thesis", "Credit");
    expect(viewer()).toHaveAttribute("data-deals", "3");
    expect(viewer()).toHaveAttribute("data-team", "1");
    expect(viewer()).toHaveAttribute("data-entities", "1");
    expect(viewer()).toHaveAttribute("data-sections", "marketing,thesis");
  });

  it("hides the Build pages and sections a restricted link does not allow", async () => {
    setup({ active: true });
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: "s-mkt" } });
    expect(viewer()).toHaveAttribute("data-sections", "marketing");
    expect(viewer()).toHaveAttribute("data-thesis", "");
    expect(viewer()).toHaveAttribute("data-deals", "0");
    expect(viewer()).toHaveAttribute("data-team", "0");
    expect(viewer()).toHaveAttribute("data-entities", "0");
    expect(screen.getByText(/1 section hidden from this link/)).toBeInTheDocument();
    expect(screen.getByText(/Gates: email/)).toBeInTheDocument();
  });
});

describe("opening on a document", () => {
  it("hands the viewer the document a row in Room contents asked for", async () => {
    setup({ active: true, focusDocumentId: "t1" });
    await waitFor(() => expect(viewer()).toHaveAttribute("data-focus", "t1"));
  });
});

describe("size", () => {
  it("switches between desktop and phone width", async () => {
    const { container } = setup({ active: true });
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    expect(container.querySelector("[data-preview-width]")).toHaveAttribute("data-preview-width", "desktop");
    fireEvent.click(screen.getByRole("button", { name: "Phone" }));
    expect(container.querySelector("[data-preview-width]")).toHaveAttribute("data-preview-width", "phone");
    expect(screen.getByRole("button", { name: "Phone" })).toHaveAttribute("aria-pressed", "true");
  });

  it("goes full screen and leaves on Escape", async () => {
    setup({ active: true });
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("never showing the wrong or an outdated answer", () => {
  it("does not show one room's documents in another room", async () => {
    const loadPreview = jest.fn(async () => payload);
    const { rerender } = render(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    // Switch rooms with the pane closed: room 1's answer must not appear for room 2.
    rerender(<RoomPreview roomId="r2" shares={SHARES} active={false} loadPreview={loadPreview} />);
    expect(screen.queryByTestId("viewer")).toBeNull();
  });

  it("drops the old preview when the reload fails, instead of leaving it up", async () => {
    const loadPreview = jest.fn<Promise<PreviewPayload | null>, []>().mockResolvedValueOnce(payload).mockResolvedValueOnce(null);
    const { rerender } = render(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    rerender(<RoomPreview roomId="r1" shares={SHARES} active={false} loadPreview={loadPreview} />);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active loadPreview={loadPreview} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preview unavailable."));
    expect(screen.queryByTestId("viewer")).toBeNull();
  });
});

describe("asking for the same document again", () => {
  it("reopens the viewer on it each time, not only the first", async () => {
    const loadPreview = jest.fn(async () => payload);
    const { rerender } = render(<RoomPreview roomId="r1" shares={SHARES} active focusDocumentId="t1" focusRequest={1} loadPreview={loadPreview} />);
    await waitFor(() => expect(viewer()).toBeInTheDocument());
    const first = viewer();
    rerender(<RoomPreview roomId="r1" shares={SHARES} active focusDocumentId="t1" focusRequest={1} loadPreview={loadPreview} />);
    expect(viewer()).toBe(first);
    rerender(<RoomPreview roomId="r1" shares={SHARES} active focusDocumentId="t1" focusRequest={2} loadPreview={loadPreview} />);
    expect(viewer()).not.toBe(first);
  });
});

describe("phone width", () => {
  it("asks the viewer for its phone layout, since the window itself is still wide", async () => {
    setup({ active: true });
    await waitFor(() => expect(viewer()).toHaveAttribute("data-compact", "false"));
    fireEvent.click(screen.getByRole("button", { name: "Phone" }));
    expect(viewer()).toHaveAttribute("data-compact", "true");
  });
});
