import { officeInvitePath, officeInviteUrl } from "./floor-link";

describe("officeInvitePath", () => {
  it("is the bare floor path with no options", () => {
    expect(officeInvitePath()).toBe("/virtual-office");
  });

  it("gives each room its own stable link", () => {
    expect(officeInvitePath({ room: "boardroom" })).toBe("/virtual-office?room=boardroom");
    expect(officeInvitePath({ room: "marketplace" })).toBe("/virtual-office?room=marketplace");
  });

  it("adds meet=1 for a video-meeting link", () => {
    expect(officeInvitePath({ room: "boardroom", meet: true })).toBe("/virtual-office?room=boardroom&meet=1");
  });

  it("omits an empty/nullish room", () => {
    expect(officeInvitePath({ room: null })).toBe("/virtual-office");
    expect(officeInvitePath({ room: "" })).toBe("/virtual-office");
  });

  it("carries a deal-room listing id", () => {
    expect(officeInvitePath({ room: "trading", deal: "abc-123" })).toBe(
      "/virtual-office?room=trading&deal=abc-123",
    );
    expect(officeInvitePath({ room: "trading", meet: true, deal: "abc-123" })).toBe(
      "/virtual-office?room=trading&meet=1&deal=abc-123",
    );
  });

  it("omits an empty/nullish deal", () => {
    expect(officeInvitePath({ room: "trading", deal: null })).toBe("/virtual-office?room=trading");
    expect(officeInvitePath({ room: "trading", deal: "" })).toBe("/virtual-office?room=trading");
  });

  it("carries a single-use invite token", () => {
    expect(officeInvitePath({ room: "boardroom", meet: true, invite: "tok_123" })).toBe(
      "/virtual-office?room=boardroom&meet=1&invite=tok_123",
    );
  });

  it("omits an empty/nullish invite", () => {
    expect(officeInvitePath({ room: "boardroom", invite: null })).toBe("/virtual-office?room=boardroom");
    expect(officeInvitePath({ room: "boardroom", invite: "" })).toBe("/virtual-office?room=boardroom");
  });
});

describe("officeInviteUrl", () => {
  it("joins origin and path and trims a trailing slash", () => {
    expect(officeInviteUrl("https://app.test/", { room: "trading" })).toBe(
      "https://app.test/virtual-office?room=trading",
    );
    expect(officeInviteUrl("https://app.test", { room: "boardroom", meet: true })).toBe(
      "https://app.test/virtual-office?room=boardroom&meet=1",
    );
  });
});
