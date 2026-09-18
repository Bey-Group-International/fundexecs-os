/**
 * The People tab, and the half of "Remove" that had nowhere to live.
 *
 * Removing somebody is durable now — written down, refused at the door — where
 * before it lasted exactly as long as it took them to press reload. That closes
 * a real hole and opens a smaller one: a misclick used to correct itself, and
 * now it does not. So the panel has to be able to undo it, and it has to be the
 * host's panel only.
 */

jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useParams: () => ({ roomId: "abc-defg-hij" }),
  useSearchParams: () => new URLSearchParams(),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotSidebar } from "./MeetingRoom";
import { subjectFor, type RemovalSubject } from "@/lib/meetings/removal";

const guest = (key: string): RemovalSubject => subjectFor(null, key)!;
const member = (id: string): RemovalSubject => subjectFor(id, null)!;

function setup(props: Partial<React.ComponentProps<typeof CopilotSidebar>> = {}) {
  const onAllowBack = jest.fn();
  const onKick = jest.fn();
  render(
    <CopilotSidebar
      srStatus="active"
      participants={[
        { id: "p1", displayName: "Alina", micOn: true, isLocal: true },
        { id: "p2", displayName: "Rae", micOn: true, isLocal: false },
      ]}
      speaking={new Set()}
      roomCode="abc-defg-hij"
      meetingTitle="Fund IV sync"
      chatMessages={[]}
      chatUnread={0}
      onSendChat={jest.fn()}
      onRetryChat={jest.fn()}
      isHost
      raisedHands={new Set()}
      onKick={onKick}
      onAdmit={jest.fn()}
      onDeny={jest.fn()}
      onAdmitAll={jest.fn()}
      waitingPeers={[]}
      removedPeople={[]}
      onAllowBack={onAllowBack}
      onChatVisibility={jest.fn()}
      onCollapse={jest.fn()}
      {...props}
    />,
  );
  return { onAllowBack, onKick, user: userEvent.setup() };
}

/** The People tab, which is not the one the panel opens on. */
async function openPeople(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /People/ }));
}

describe("removed people", () => {
  it("names them, with a way back", async () => {
    const { user } = setup({
      removedPeople: [{ subject: guest("g1"), displayName: "Mal" }],
    });
    await openPeople(user);
    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("Mal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow back" })).toBeInTheDocument();
  });

  it("hands back the subject, not a name or a tile id", async () => {
    const subject = member("u2");
    const { onAllowBack, user } = setup({ removedPeople: [{ subject, displayName: "Sam" }] });
    await openPeople(user);
    await user.click(screen.getByRole("button", { name: "Allow back" }));
    expect(onAllowBack).toHaveBeenCalledWith(subject);
  });

  // Most meetings remove nobody, and an empty heading on every call would be
  // noise on the majority of them.
  it("says nothing when nobody has been removed", async () => {
    const { user } = setup({ removedPeople: [] });
    await openPeople(user);
    expect(screen.queryByText("Removed")).not.toBeInTheDocument();
  });

  // Undo is the host's authority, the same as the removal was. A participant
  // being shown a list of who the host removed is also not their business.
  it("is the host's panel only", async () => {
    const { user } = setup({
      isHost: false,
      removedPeople: [{ subject: guest("g1"), displayName: "Mal" }],
    });
    await openPeople(user);
    expect(screen.queryByText("Removed")).not.toBeInTheDocument();
    expect(screen.queryByText("Mal")).not.toBeInTheDocument();
  });

  // Two removed guests sharing a display name — which is the normal case for
  // "Guest" — must be two rows, not one dropped by a duplicate React key.
  it("lists two people who share a name", async () => {
    const { user } = setup({
      removedPeople: [
        { subject: guest("g1"), displayName: "Guest" },
        { subject: guest("g2"), displayName: "Guest" },
      ],
    });
    await openPeople(user);
    expect(screen.getAllByRole("button", { name: "Allow back" })).toHaveLength(2);
  });
});

describe("removing somebody", () => {
  it("offers Remove to the host, for everyone but themselves", async () => {
    const { user } = setup();
    await openPeople(user);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("offers it to nobody else", async () => {
    const { user } = setup({ isHost: false });
    await openPeople(user);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});
