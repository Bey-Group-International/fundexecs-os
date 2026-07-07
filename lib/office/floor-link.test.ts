import { officeInvitePath, officeInviteUrl } from "./floor-link";

describe("officeInvitePath", () => {
  it("is the bare floor path with no options", () => {
    expect(officeInvitePath()).toBe("/command-center");
  });

  it("gives each room its own stable link", () => {
    expect(officeInvitePath({ room: "boardroom" })).toBe("/command-center?room=boardroom");
    expect(officeInvitePath({ room: "marketplace" })).toBe("/command-center?room=marketplace");
  });

  it("adds meet=1 for a video-meeting link", () => {
    expect(officeInvitePath({ room: "boardroom", meet: true })).toBe("/command-center?room=boardroom&meet=1");
  });

  it("omits an empty/nullish room", () => {
    expect(officeInvitePath({ room: null })).toBe("/command-center");
    expect(officeInvitePath({ room: "" })).toBe("/command-center");
  });
});

describe("officeInviteUrl", () => {
  it("joins origin and path and trims a trailing slash", () => {
    expect(officeInviteUrl("https://app.test/", { room: "trading" })).toBe(
      "https://app.test/command-center?room=trading",
    );
    expect(officeInviteUrl("https://app.test", { room: "boardroom", meet: true })).toBe(
      "https://app.test/command-center?room=boardroom&meet=1",
    );
  });
});
