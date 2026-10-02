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

  it("won't save an entry that isn't a domain", () => {
    renderWith(live());
    fireEvent.click(screen.getByRole("button", { name: "Edit access →" }));
    fireEvent.change(screen.getByPlaceholderText(/calpers\.ca\.gov, ilpa\.org/), { target: { value: "calpers" } });
    expect(screen.getByText("Not a domain: calpers")).toBeInTheDocument();
    expect((screen.getByRole("button", { name: "Save access" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
