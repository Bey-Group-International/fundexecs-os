/**
 * The host's exits from a live meeting.
 *
 * A host used to have exactly one, and it ended the call for everyone. The
 * second exit is the feature; what these pin is that adding it did not quietly
 * change the first. Pressing the red button still ends for all — a host's
 * muscle memory is load-bearing here, and a control that sometimes ends the
 * meeting and sometimes does not would be worse than not having the option.
 *
 * Rendered directly rather than through MeetingRoom: reaching the control bar
 * means entering a room, which opens a camera, an ICE negotiation and a
 * Realtime channel. MeetingRoom.admission.test.tsx stops short of that on
 * purpose, and a test that mocked all of it would be testing its own mocks.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HostExitControl } from "./MeetingRoom";

function setup(props: Partial<React.ComponentProps<typeof HostExitControl>> = {}) {
  const onLeave = jest.fn();
  const onEndForAll = jest.fn();
  render(
    <HostExitControl
      leaving={false}
      waitingCount={0}
      onLeave={onLeave}
      onEndForAll={onEndForAll}
      {...props}
    />,
  );
  return { onLeave, onEndForAll, user: userEvent.setup() };
}

/** Open the chevron, which is the deliberate step before the second exit. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /other ways to leave/i }));
}

describe("the primary press", () => {
  it("still ends the meeting for everyone", async () => {
    const { onLeave, onEndForAll, user } = setup();

    await user.click(screen.getByRole("button", { name: /end for all/i }));

    expect(onEndForAll).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  // The second exit is behind a chevron precisely so it cannot be hit by
  // someone reaching for the first.
  it("does not expose leaving until the menu is opened", () => {
    setup();
    expect(screen.queryByText(/leave without ending/i)).not.toBeInTheDocument();
  });

  // Asserted as the attribute, not through getByRole's name: the label span is
  // hidden below `sm` by a Tailwind class, and jsdom applies no stylesheet — so
  // a name query passes whether or not the button is nameable on a real phone,
  // which is the only place the bug exists. PhoneOffIcon is a bare <svg> with no
  // text alternative, so without this the control announced as "button".
  it("names itself for a screen reader on a phone, where the label is hidden", () => {
    setup();
    expect(screen.getByRole("button", { name: /end for all/i })).toHaveAttribute("aria-label", "End for all");
  });

  // The ControlBar stays mounted under the "ending" overlay, and FloatingMenu
  // portals to document.body at z-[9999] against that overlay's z-50 — an open
  // menu would hang over the report-generating screen.
  //
  // Driven by keyboard, which is the only way to reach this. FloatingMenu
  // already closes on any mousedown outside its panel and anchor, so a MOUSE
  // press on this button dismisses the menu before the click handler runs and
  // the assertion holds whether or not the handler closes anything. Keyboard
  // activation fires click with no preceding mousedown, so it is the one path
  // where closing has to be done explicitly — and the one that fails if the
  // setOpen(false) is removed.
  it("closes the menu it left open when the call is ended from the keyboard", async () => {
    const { onEndForAll, user } = setup();

    await openMenu(user);
    expect(screen.getByRole("menuitem")).toBeInTheDocument();

    screen.getByRole("button", { name: /end for all/i }).focus();
    await user.keyboard("{Enter}");

    expect(onEndForAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});

describe("leaving without ending", () => {
  it("leaves without ending the meeting for anyone else", async () => {
    const { onLeave, onEndForAll, user } = setup();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /leave without ending/i }));

    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onEndForAll).not.toHaveBeenCalled();
  });

  it("says the meeting survives, which is the reason to press it", async () => {
    const { user } = setup();

    await openMenu(user);

    expect(screen.getByRole("menuitem")).toHaveTextContent(/keeps running/i);
    expect(screen.getByRole("menuitem")).toHaveTextContent(/rejoin/i);
  });

  // The cost that lands on someone else. Admission is checked against host_id
  // server-side, so a host who leaves with people knocking strands them on a
  // request nobody left in the room can answer.
  it("names the guests who would be stranded in the waiting room", async () => {
    const { user } = setup({ waitingCount: 2 });

    await openMenu(user);

    expect(screen.getByRole("menuitem")).toHaveTextContent(/2 people are still waiting/i);
    expect(screen.getByRole("menuitem")).toHaveTextContent(/only you can let them in/i);
  });
});

describe("once an exit is already under way", () => {
  // Ending posts a transcript to a model. A second exit press of either kind
  // would tear down an already dead call, and the end path would post a second
  // report — another stored row and another batch of auto-created tasks.
  it("refuses both exits", async () => {
    const { onLeave, onEndForAll, user } = setup({ leaving: true });

    await user.click(screen.getByRole("button", { name: /ending/i }));
    expect(onEndForAll).not.toHaveBeenCalled();

    // The chevron is disabled too, so the menu is unreachable rather than
    // merely holding an inert row.
    expect(screen.getByRole("button", { name: /other ways to leave/i })).toBeDisabled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("shows progress on the primary control", () => {
    setup({ leaving: true });
    expect(screen.getByRole("button", { name: /ending…/i })).toBeInTheDocument();
  });
});
