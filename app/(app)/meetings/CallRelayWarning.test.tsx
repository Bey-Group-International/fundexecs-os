import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallRelayWarning } from "./CallRelayWarning";

beforeEach(() => window.localStorage.clear());

it("tells an admin guests cannot connect and names the settings to set", async () => {
  render(<CallRelayWarning reason="unconfigured" />);
  expect(await screen.findByText(/some guests can.t connect to calls/i)).toBeInTheDocument();
  expect(screen.getByText(/no call relay/i)).toBeInTheDocument();
  expect(screen.getByText("TURN_URLS")).toBeInTheDocument();
  expect(screen.getByText("TURN_SECRET")).toBeInTheDocument();
});

it("says what is wrong when the relay is half set up", async () => {
  render(<CallRelayWarning reason="misconfigured" />);
  expect(await screen.findByText(/only half set up/i)).toBeInTheDocument();
});

it("stays dismissed in this browser", async () => {
  const { unmount } = render(<CallRelayWarning reason="unconfigured" />);
  await userEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
  expect(screen.queryByText(/some guests can.t connect/i)).toBeNull();
  unmount();
  render(<CallRelayWarning reason="unconfigured" />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText(/some guests can.t connect/i)).toBeNull();
});
