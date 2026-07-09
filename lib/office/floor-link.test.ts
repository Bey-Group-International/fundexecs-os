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

  it("carries a deal-room listing id", () => {
    expect(officeInvitePath({ room: "trading", deal: "abc-123" })).toBe(
      "/command-center?room=trading&deal=abc-123",
    );
    expect(officeInvitePath({ room: "trading", meet: true, deal: "abc-123" })).toBe(
      "/command-center?room=trading&meet=1&deal=abc-123",
    );
  });

  it("omits an empty/nullish deal", () => {
    expect(officeInvitePath({ room: "trading", deal: null })).toBe("/command-center?room=trading");
    expect(officeInvitePath({ room: "trading", deal: "" })).toBe("/command-center?room=trading");
  });

  it("carries a single-use invite token", () => {
    expect(officeInvitePath({ room: "boardroom", meet: true, invite: "tok_123" })).toBe(
      "/command-center?room=boardroom&meet=1&invite=tok_123",
    );
  });

  it("omits an empty/nullish invite", () => {
    expect(officeInvitePath({ room: "boardroom", invite: null })).toBe("/command-center?room=boardroom");
    expect(officeInvitePath({ room: "boardroom", invite: "" })).toBe("/command-center?room=boardroom");
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
