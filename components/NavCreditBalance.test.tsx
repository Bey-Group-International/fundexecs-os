/**
 * The nav balance is the number an operator checks to confirm a debit happened.
 * It used to be a server prop on a layout, which React reuses across every
 * client-side navigation — so it froze at whatever the balance was when the tab
 * loaded, and a real spend looked like nothing had been charged.
 */
const getCreditBalance = jest.fn();
jest.mock("@/app/(app)/nav-actions", () => ({
  getCreditBalance: () => getCreditBalance(),
}));

import { render, screen, act } from "@testing-library/react";
import { NavCreditBalance, CREDITS_CHANGED_EVENT } from "./NavCreditBalance";

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("paints the server value first, with no flash of zero", () => {
  getCreditBalance.mockResolvedValue(746);
  render(<NavCreditBalance initialBalance={750} />);
  expect(screen.getByText("750")).toBeInTheDocument();
});

it("picks up a debit made after the page was rendered", async () => {
  getCreditBalance.mockResolvedValue(746);
  render(<NavCreditBalance initialBalance={750} />);

  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });

  expect(screen.getByText("746")).toBeInTheDocument();
});

it("takes a balance handed to it directly, without waiting for the poll", async () => {
  getCreditBalance.mockResolvedValue(750);
  render(<NavCreditBalance initialBalance={750} />);

  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(CREDITS_CHANGED_EVENT, { detail: { balance: 1_250 } }),
    );
  });

  expect(screen.getByText("1,250")).toBeInTheDocument();
  // The figure was supplied, so no re-read was needed.
  expect(getCreditBalance).not.toHaveBeenCalled();
});

it("re-reads when told the balance changed but not what to", async () => {
  getCreditBalance.mockResolvedValue(500);
  render(<NavCreditBalance initialBalance={750} />);

  await act(async () => {
    window.dispatchEvent(new CustomEvent(CREDITS_CHANGED_EVENT));
  });

  expect(screen.getByText("500")).toBeInTheDocument();
});

it("holds its last value when a refresh fails, rather than showing a wrong one", async () => {
  getCreditBalance.mockRejectedValue(new Error("network"));
  render(<NavCreditBalance initialBalance={750} />);

  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });

  expect(screen.getByText("750")).toBeInTheDocument();
});
