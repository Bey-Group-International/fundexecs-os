import { cleanGuestEmail } from "./guest-email";

describe("cleanGuestEmail", () => {
  it("keeps a plausible address, lower-cased and trimmed", () => {
    expect(cleanGuestEmail("  Dana@Fund.Test ")).toBe("dana@fund.test");
  });

  it.each([[""], ["dana"], ["dana@fund"], ["da na@fund.test"], [42], [null], ["a@b.c" + "x".repeat(260)]])(
    "treats %p as no address rather than refusing the join",
    (raw) => {
      expect(cleanGuestEmail(raw)).toBeNull();
    },
  );
});
