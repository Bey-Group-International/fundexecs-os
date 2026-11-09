/**
 * The Remind button is wired where it should be: next to each teammate except
 * yourself, for owners and admins only, and on every pending invite. Clicking it
 * hands the right id to the server action and reports the outcome.
 */
const resendInvite = jest.fn();
jest.mock("./team-actions", () => ({
  updateMyProfile: jest.fn(),
  assignTeamTask: jest.fn(),
  changeMemberRole: jest.fn(),
  removeMember: jest.fn(),
  inviteMember: jest.fn(),
  addTeamProfile: jest.fn(),
  updateTeamProfile: jest.fn(),
  deleteTeamProfile: jest.fn(),
  giveProfileAccess: jest.fn(),
  resendInvite: (...a: unknown[]) => resendInvite(...a),
}));
jest.mock("@/components/shared/AvatarUpload", () => ({ AvatarUpload: () => <span>avatar</span> }));
jest.mock("./DraftWithEarn", () => ({ inputClass: "" }));

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TeamControls, type TeamMemberView, type PendingInviteView } from "./TeamControls";

const member = (id: string, name: string, role: TeamMemberView["role"], email = `${id}@firm.com`): TeamMemberView => ({
  memberId: `m-${id}`,
  principalId: `p-${id}`,
  name,
  email,
  title: null,
  bio: null,
  avatarUrl: null,
  role,
});

const members = [member("me", "Me Myself", "owner"), member("ann", "Ann", "member"), member("bob", "Bob", "admin")];
const pending: PendingInviteView[] = [
  { inviteId: "i-1", email: "newhire@firm.com", role: "member", sentAt: "2026-11-03T12:00:00Z" },
];
const ownProfile = { full_name: null, title: null, bio: null, avatar_url: null };
const seats = { used: 3, limit: null };

function renderTeam(role: "owner" | "admin" | "member", invites = pending) {
  return render(
    <TeamControls
      members={members}
      profiles={[]}
      pendingInvites={invites}
      currentUserId="p-me"
      currentRole={role}
      ownProfile={ownProfile}
      seats={seats}
    />,
  );
}

beforeEach(() => {
  resendInvite.mockReset();
  resendInvite.mockResolvedValue({ notice: "Reminder sent to x." });
});

describe("Remind button", () => {
  it("shows beside every teammate except yourself, plus every pending invite", () => {
    renderTeam("owner");
    // ann + bob + the one pending invite; not "me".
    expect(screen.getAllByRole("button", { name: /^remind$/i })).toHaveLength(3);
  });

  it("marks an expired invite and still offers Remind, which renews it", () => {
    renderTeam("owner", [
      ...pending,
      { inviteId: "i-old", email: "old@firm.com", role: "admin", sentAt: "2026-09-01T12:00:00Z", expired: true },
    ]);
    const oldRow = screen.getByText("old@firm.com").closest("div.rounded-xl") as HTMLElement;
    expect(within(oldRow).getByText(/expired/i)).toBeTruthy();
    expect(within(oldRow).getByRole("button", { name: /remind/i })).toBeTruthy();
    const freshRow = screen.getByText("newhire@firm.com").closest("div.rounded-xl") as HTMLElement;
    expect(within(freshRow).queryByText(/expired/i)).toBeNull();
  });

  it("is absent for a plain member, who also sees no pending list", () => {
    renderTeam("member");
    expect(screen.queryAllByRole("button", { name: /remind/i })).toHaveLength(0);
    expect(screen.queryByText(/pending invites/i)).toBeNull();
    expect(screen.queryByText("newhire@firm.com")).toBeNull();
  });

  it("is absent for a member with no email on file", () => {
    render(
      <TeamControls
        members={[member("me", "Me", "owner"), member("x", "No Email", "member", "")]}
        profiles={[]}
        currentUserId="p-me"
        currentRole="owner"
        ownProfile={ownProfile}
        seats={seats}
      />,
    );
    expect(screen.queryAllByRole("button", { name: /remind/i })).toHaveLength(0);
  });

  it("sends the member's id for a member and the invite id for a pending invite", async () => {
    renderTeam("admin");
    const annRow = screen.getByText("Ann", { selector: "span.truncate" }).closest("div.rounded-xl") as HTMLElement;
    fireEvent.click(within(annRow).getByRole("button", { name: /remind/i }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalledTimes(1));
    const fd1 = resendInvite.mock.calls[0][0] as FormData;
    expect(fd1.get("memberId")).toBe("m-ann");
    expect(fd1.get("inviteId")).toBeNull();

    const inviteRow = screen.getByText("newhire@firm.com").closest("div.rounded-xl") as HTMLElement;
    fireEvent.click(within(inviteRow).getByRole("button", { name: /remind/i }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalledTimes(2));
    const fd2 = resendInvite.mock.calls[1][0] as FormData;
    expect(fd2.get("inviteId")).toBe("i-1");
    expect(fd2.get("memberId")).toBeNull();
  });

  it("confirms a send and shows the server's error otherwise", async () => {
    renderTeam("owner");
    const annRow = screen.getByText("Ann", { selector: "span.truncate" }).closest("div.rounded-xl") as HTMLElement;
    fireEvent.click(within(annRow).getByRole("button", { name: /remind/i }));
    expect(await within(annRow).findByText(/sent/i)).toBeTruthy();

    resendInvite.mockResolvedValue({ error: "A reminder was just sent to ann. Try again in a few minutes." });
    fireEvent.click(within(annRow).getByRole("button", { name: /remind/i }));
    expect(await within(annRow).findByText(/just sent/i)).toBeTruthy();
  });
});
