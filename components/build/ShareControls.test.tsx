const updateShareAlerts = jest.fn(async () => undefined);
const updateShareAccess = jest.fn(async () => ({ ok: true }));
jest.mock("./materials-actions", () => ({
  createShare: jest.fn(),
  revokeShare: jest.fn(),
  updateShareAlerts: (...a: unknown[]) => updateShareAlerts(...(a as [])),
  updateShareAccess: (...a: unknown[]) => updateShareAccess(...(a as [])),
}));

jest.mock("./actions", () => ({}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShareControls, type ShareView } from "./ShareControls";

const live = (over: Partial<ShareView> = {}): ShareView => ({
  id: "s1",
  token: "tok",
  label: "Fund II LPs",
  expires_at: null,
  revoked_at: null,
  created_at: "2026-10-01T00:00:00Z",
  allowed_sections: null,
  ...over,
});

function renderWith(share: ShareView) {
  return render(<ShareControls roomId="r1" roomName="Fund II" publishedSections={[]} shares={[share]} />);
}

describe("alert toggles on a live link", () => {
  beforeEach(() => updateShareAlerts.mockClear());

  it("shows the link's current alert settings", () => {
    renderWith(live({ notify_on_open: true, daily_digest: false }));
    expect(screen.getByRole("button", { name: "First open per reader" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Daily digest" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("turns the daily digest on for that link", async () => {
    renderWith(live());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Daily digest" }));
    });
    expect(updateShareAlerts).toHaveBeenCalledWith("s1", { dailyDigest: true });
    expect(screen.getByRole("button", { name: "Daily digest" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("is not offered on a revoked link", () => {
    renderWith(live({ revoked_at: "2026-10-01T00:00:00Z" }));
    expect(screen.queryByRole("button", { name: "Daily digest" })).toBeNull();
  });
});

describe("access on a live link", () => {
  beforeEach(() => updateShareAccess.mockClear());

  it("shows the link's domain and reader limits", () => {
    renderWith(live({ allowed_email_domains: ["calpers.ca.gov"], max_readers: 10, reader_count: 3 }));
    expect(screen.getByText("@calpers.ca.gov")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 readers")).toBeInTheDocument();
  });

  it("saves a new expiry, domains and reader limit in place", async () => {
    renderWith(live());
    fireEvent.click(screen.getByRole("button", { name: "Edit access →" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "30" } });
    fireEvent.change(screen.getByPlaceholderText(/calpers\.ca\.gov, ilpa\.org/), { target: { value: "calpers.ca.gov" } });
    fireEvent.change(screen.getByPlaceholderText("Blank for no limit"), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    });
    expect(updateShareAccess).toHaveBeenCalledWith("s1", { expiresInDays: 30, allowedDomains: "calpers.ca.gov", maxReaders: 5 });
    expect(screen.getByText("Saved. The link keeps its URL.")).toBeInTheDocument();
  });

  it("lets an expired link be given a new expiry, starting on 30 days", async () => {
    renderWith(live({ expires_at: "2020-01-01T00:00:00Z" }));
    expect(screen.getByText("Expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit access →" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("30");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    });
    expect(updateShareAccess).toHaveBeenCalledWith("s1", { expiresInDays: 30, allowedDomains: "", maxReaders: null });
  });

  it("keeps a revoked link closed to editing", () => {
    renderWith(live({ revoked_at: "2026-10-01T00:00:00Z" }));
    expect(screen.queryByRole("button", { name: "Edit access →" })).toBeNull();
  });

  it("won't save an entry that isn't a domain", () => {
    renderWith(live());
    fireEvent.click(screen.getByRole("button", { name: "Edit access →" }));
    fireEvent.change(screen.getByPlaceholderText(/calpers\.ca\.gov, ilpa\.org/), { target: { value: "calpers" } });
    expect(screen.getByText("Not a domain: calpers")).toBeInTheDocument();
    expect((screen.getByRole("button", { name: "Save access" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("reactivating an expired link", () => {
  beforeEach(() => updateShareAccess.mockClear());

  it("brings it back for 30 days in one click", async () => {
    renderWith(live({ expires_at: "2020-01-01T00:00:00Z" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate 30 days" }));
    });
    expect(updateShareAccess).toHaveBeenCalledWith("s1", { expiresInDays: 30 });
  });

  it("says so when it can't", async () => {
    updateShareAccess.mockResolvedValueOnce({ ok: false, error: "No edit access." } as never);
    renderWith(live({ expires_at: "2020-01-01T00:00:00Z" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reactivate 30 days" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("No edit access.");
  });

  it("is not offered on a live or a revoked link", () => {
    const { unmount } = renderWith(live());
    expect(screen.queryByRole("button", { name: /Reactivate/ })).toBeNull();
    unmount();
    renderWith(live({ revoked_at: "2026-10-01T00:00:00Z" }));
    expect(screen.queryByRole("button", { name: /Reactivate/ })).toBeNull();
  });
});

describe("a long list of links", () => {
  const many = (n: number, over: (i: number) => Partial<ShareView> = () => ({})) =>
    Array.from({ length: n }, (_, i) =>
      live({ id: `s${i}`, token: `tok${i}`, label: `Link ${i}`, created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`, ...over(i) }),
    );
  const renderMany = (shares: ShareView[]) =>
    render(<ShareControls roomId="r1" roomName="Fund II" publishedSections={[]} shares={shares} />);

  it("keeps a short list as it was: no search, sort or tabs", () => {
    renderMany(many(3));
    expect(screen.queryByLabelText("Search links")).toBeNull();
    expect(screen.queryByLabelText("Sort links")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Live/ })).toBeNull();
  });

  it("shows ten at a time and pages the rest", () => {
    renderMany(many(12));
    expect(screen.getAllByText(/^Link \d+$/)).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more (2 left)" }));
    expect(screen.getAllByText(/^Link \d+$/)).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it("searches by label", () => {
    renderMany(many(8));
    fireEvent.change(screen.getByLabelText("Search links"), { target: { value: "link 3" } });
    expect(screen.getAllByText(/^Link \d+$/).map((e) => e.textContent)).toEqual(["Link 3"]);
    fireEvent.change(screen.getByLabelText("Search links"), { target: { value: "zzz" } });
    expect(screen.getByText('No live links match "zzz".')).toBeInTheDocument();
  });

  it("sorts newest first, or by soonest expiry", () => {
    // The newest link is the one that expires last, so the two orders disagree.
    const later = (i: number) => ({ expires_at: new Date(Date.now() + (i + 1) * 86_400_000).toISOString() });
    renderMany(many(8, later));
    const labels = () => screen.getAllByText(/^Link \d+$/).map((e) => e.textContent);
    expect(labels()[0]).toBe("Link 7");
    fireEvent.change(screen.getByLabelText("Sort links"), { target: { value: "expiring" } });
    expect(labels()[0]).toBe("Link 0");
    expect(labels()[7]).toBe("Link 7");
  });

  it("splits live from expired, opening on live", () => {
    const shares = [
      ...many(2),
      live({ id: "old", label: "Old link", expires_at: "2020-01-01T00:00:00Z" }),
    ];
    renderMany(shares);
    expect(screen.getByRole("button", { name: "Live (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expired (1)" })).toBeInTheDocument();
    expect(screen.queryByText("Old link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expired (1)" }));
    expect(screen.getByText("Old link")).toBeInTheDocument();
    expect(screen.queryByText("Link 0")).toBeNull();
  });

  it("opens on the expired links when none are live", () => {
    renderMany([live({ id: "old", label: "Old link", expires_at: "2020-01-01T00:00:00Z" })]);
    expect(screen.getByText("Old link")).toBeInTheDocument();
  });

  it("never lists a revoked link", () => {
    renderMany([...many(2), live({ id: "gone", label: "Gone link", revoked_at: "2026-10-01T00:00:00Z" })]);
    expect(screen.queryByText("Gone link")).toBeNull();
  });
});
