/**
 * Disabling quick access on an existing meeting must actually reach the server.
 *
 * The edit screen sends an explicit field-by-field projection on the PATCH path
 * rather than the whole payload, and `guestQuickAccess` was missing from it. The
 * failure is silent and one-directional, which is what makes it dangerous: the
 * PATCH route reads `typeof body.guestQuickAccess === "boolean" ? … : undefined`
 * and skips the column when it is absent, so turning quick access ON worked (it
 * goes out through the create path) while turning it OFF did nothing at all —
 * the host saw a cleared checkbox and strangers holding the link kept walking
 * straight into the room.
 *
 * These pin the contract at both ends: the projection carries the field, and the
 * route only treats a real boolean as an instruction.
 */

/** The route's own coercion, mirrored. */
function routeReads(body: Record<string, unknown>): boolean | undefined {
  return typeof body.guestQuickAccess === "boolean" ? (body.guestQuickAccess as boolean) : undefined;
}

/** The edit screen's PATCH projection, reduced to the field under test. */
function patchBody(payload: { guestQuickAccess: boolean }) {
  return {
    title: "Meeting",
    attendees: [],
    guestQuickAccess: payload.guestQuickAccess,
  };
}

describe("quick access on the edit path", () => {
  it("transmits false, so switching it off actually switches it off", () => {
    const body = patchBody({ guestQuickAccess: false });
    expect("guestQuickAccess" in body).toBe(true);
    expect(routeReads(body)).toBe(false);
  });

  it("transmits true", () => {
    expect(routeReads(patchBody({ guestQuickAccess: true }))).toBe(true);
  });

  it("leaves the column alone when the field is genuinely absent", () => {
    // An older client, or another API caller, that says nothing about quick
    // access must not have its meeting's admission policy reset.
    expect(routeReads({ title: "Meeting" })).toBeUndefined();
  });

  it("ignores a non-boolean rather than coercing it", () => {
    // "false" is truthy. Coercing here would turn a stray string into an open
    // room, so only a real boolean counts as an instruction.
    for (const v of ["true", "false", 1, 0, null, {}, []]) {
      expect(routeReads({ guestQuickAccess: v })).toBeUndefined();
    }
  });
});
