/**
 * The lobby's two ways into the calendar: "Calendar" to look at it, and
 * "Schedule for later" to book something on it.
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

import { MeetingLobby } from "./MeetingLobby";

beforeEach(() => {
  // The scheduler asks whether a calendar is connected when it opens.
  global.fetch = (async () => ({ ok: false, json: async () => null })) as unknown as typeof fetch;
});

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /new meeting/i }));
}

it("asks for the scheduler, not just the calendar, from Schedule for later", () => {
  const onOpenCalendar = jest.fn();
  const onScheduleLater = jest.fn();
  render(<MeetingLobby onOpenCalendar={onOpenCalendar} onScheduleLater={onScheduleLater} />);

  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /schedule for later/i }));

  expect(onScheduleLater).toHaveBeenCalledTimes(1);
  expect(onOpenCalendar).not.toHaveBeenCalled();
});

it("opens just the calendar from the Calendar button", () => {
  const onOpenCalendar = jest.fn();
  const onScheduleLater = jest.fn();
  render(<MeetingLobby onOpenCalendar={onOpenCalendar} onScheduleLater={onScheduleLater} />);

  fireEvent.click(screen.getByRole("button", { name: /^calendar$/i }));

  expect(onOpenCalendar).toHaveBeenCalledTimes(1);
  expect(onScheduleLater).not.toHaveBeenCalled();
});

it("opens the scheduler by itself when there is no calendar behind the lobby", async () => {
  render(<MeetingLobby />);
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /schedule for later/i }));
  expect(await screen.findByRole("dialog", { name: "Schedule a meeting" })).toBeInTheDocument();
});
