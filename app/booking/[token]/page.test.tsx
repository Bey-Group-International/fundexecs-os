/**
 * The manage page itself, which is the part of this change that a component test
 * cannot reach.
 *
 * ManageBooking.test.tsx proves the client does the right thing with each of the
 * three answers it can be handed. It cannot prove the page hands one over — and
 * that is the whole optimisation: reverting this file to `<ManageBooking
 * token={token} />` puts the spinner and the round trip straight back, and every
 * other test in this change still passes. Injected and confirmed, which is why
 * this file exists.
 *
 * The page is a server component, so each case awaits it and renders what it
 * returned, following report/page.test.tsx.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import type { ManageBookingView } from "@/lib/meetings/booking-manage";

const loadManageView = jest.fn();
let hasEnv = true;

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({}) as unknown,
  hasSupabaseServiceEnv: () => hasEnv,
}));
jest.mock("@/lib/meetings/booking-manage.server", () => ({
  loadManageView: (...args: unknown[]) => loadManageView(...args),
}));

// Rendered as a marker that reports exactly what the page gave it. The three
// states are three different props, so they have to be told apart, not merely
// counted: `undefined` means fetch, `null` means the link is dead.
jest.mock("./ManageBooking", () => ({
  ManageBooking: ({
    token,
    initialView,
    serverNowIso,
  }: {
    token: string;
    initialView?: ManageBookingView | null;
    serverNowIso?: string;
  }) => (
    <div
      data-testid="manage"
      data-token={token}
      data-answer={initialView === undefined ? "absent" : initialView === null ? "null" : "view"}
      data-title={initialView?.eventType.title ?? ""}
      data-server-now={serverNowIso ?? ""}
    />
  ),
}));

import ManageBookingPage from "./page";

const VIEW: ManageBookingView = {
  booking: {
    id: "b1",
    eventTitle: "Intro call",
    inviteeName: "Ada Lovelace",
    startsAt: "2099-10-05T14:00:00.000Z",
    endsAt: "2099-10-05T14:30:00.000Z",
    status: "confirmed",
    cancelledBy: null,
    cancellationReason: null,
    inviteeTimezone: "America/New_York",
  },
  page: { slug: "ana", displayName: "Ana" },
  eventType: { title: "Intro call", durationMinutes: 30 },
  joinUrl: null,
  bookingPageUrl: "https://app.test/book/ana",
  hostTimezone: "America/New_York",
  slots: [],
};

async function renderPage(token = "tok") {
  const ui = await ManageBookingPage({ params: Promise.resolve({ token }) });
  return render(ui);
}

beforeEach(() => {
  loadManageView.mockReset();
  hasEnv = true;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

it("reads the booking on the server and hands it to the client", async () => {
  loadManageView.mockResolvedValue(VIEW);
  await renderPage();

  const marker = screen.getByTestId("manage");
  expect(marker.getAttribute("data-answer")).toBe("view");
  expect(marker.getAttribute("data-title")).toBe("Intro call");
  expect(marker.getAttribute("data-token")).toBe("tok");
  // Read once, with the token from the URL.
  expect(loadManageView).toHaveBeenCalledTimes(1);
  expect(loadManageView.mock.calls[0][1]).toBe("tok");
});

it("says the token names nothing, rather than leaving the client to find out", async () => {
  loadManageView.mockResolvedValue(null);
  await renderPage("expired");
  expect(screen.getByTestId("manage").getAttribute("data-answer")).toBe("null");
});

/**
 * The two failure cases, which must NOT look like a bad link. Telling somebody
 * their booking does not exist because a deployment is missing its keys is worse
 * than the spinner this change removed.
 */
it("leaves the client to fetch when the deployment cannot read at all", async () => {
  hasEnv = false;
  await renderPage();
  expect(screen.getByTestId("manage").getAttribute("data-answer")).toBe("absent");
  expect(loadManageView).not.toHaveBeenCalled();
});

it("leaves the client to fetch when the read fails", async () => {
  loadManageView.mockRejectedValue(new Error("connection reset"));
  await renderPage();
  expect(screen.getByTestId("manage").getAttribute("data-answer")).toBe("absent");
});

// Used for the first render's past/future decision, so the client's hydration
// agrees with this markup.
it("stamps the markup with the instant it rendered at", async () => {
  loadManageView.mockResolvedValue(VIEW);
  await renderPage();
  const stamp = screen.getByTestId("manage").getAttribute("data-server-now") ?? "";
  expect(Number.isFinite(Date.parse(stamp))).toBe(true);
  expect(Math.abs(Date.parse(stamp) - Date.now())).toBeLessThan(60_000);
});

it("keeps the page out of search results whatever it renders", async () => {
  const { metadata } = (await import("./page")) as { metadata: { robots?: { index?: boolean } } };
  expect(metadata.robots?.index).toBe(false);
});
