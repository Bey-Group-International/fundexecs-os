import { buildFloorInviteHtml } from "./floor-invite";

describe("buildFloorInviteHtml", () => {
  it("embeds an escaped sender and a safe floor link", () => {
    const html = buildFloorInviteHtml({
      floorUrl: "https://app.test/virtual-office",
      senderName: "a <b>@c.com",
    });
    expect(html).toContain("https://app.test/virtual-office");
    expect(html).toContain("a &lt;b&gt;@c.com");
    expect(html).not.toContain("<b>@c.com");
    expect(html).toContain("Enter the floor");
  });

  it("neutralizes a non-http floor URL", () => {
    const html = buildFloorInviteHtml({ floorUrl: "javascript:alert(1)", senderName: "y" });
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:alert(1)");
  });
});
