const updateShareAlerts = jest.fn(async () => undefined);
jest.mock("./materials-actions", () => ({
  createShare: jest.fn(),
  revokeShare: jest.fn(),
  updateShareAlerts: (...a: unknown[]) => updateShareAlerts(...(a as [])),
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
