// Whose address a meeting email arrives from. The refusals matter more than
// the happy path: "could not send" with no next step is what sent a host
// looking for a setting that does not exist.
import {
  GMAIL_SEND_SCOPE,
  grantCanSend,
  mailboxProblemMessage,
  problemFromTokenError,
  type MailboxProblem,
} from "./mailbox";

describe("grantCanSend", () => {
  it("accepts a grant that carries the send scope", () => {
    expect(grantCanSend(`openid email ${GMAIL_SEND_SCOPE}`)).toBe(true);
  });

  it("rejects a calendar-only grant", () => {
    // Every member who connected before sending was added to the scope set is
    // in exactly this state, so it must read as "reconnect", not "connect".
    expect(grantCanSend("openid email https://www.googleapis.com/auth/calendar")).toBe(false);
  });

  it("rejects a grant with nothing recorded", () => {
    expect(grantCanSend(null)).toBe(false);
    expect(grantCanSend(undefined)).toBe(false);
    expect(grantCanSend("")).toBe(false);
  });

  it("is not fooled by a scope that merely contains the send scope", () => {
    // Substring matching would accept a look-alike; Google separates scopes by
    // whitespace, so each one is compared whole.
    expect(grantCanSend(`${GMAIL_SEND_SCOPE}.readonly`)).toBe(false);
    expect(grantCanSend(`https://evil.test/${GMAIL_SEND_SCOPE}`)).toBe(false);
  });

  it("tolerates the whitespace Google actually returns", () => {
    expect(grantCanSend(`openid\n email  ${GMAIL_SEND_SCOPE}\t`)).toBe(true);
  });
});

describe("problemFromTokenError", () => {
  it("reads invalid_grant as something reconnecting fixes", () => {
    // Google says invalid_grant both for a revoked grant and for a changed
    // password. The member's next step is the same either way.
    expect(problemFromTokenError("invalid_grant: Token has been expired or revoked.")).toBe("revoked");
    expect(problemFromTokenError("INVALID_GRANT")).toBe("revoked");
  });

  it("treats anything else as transient", () => {
    expect(problemFromTokenError("fetch failed")).toBe("unavailable");
    expect(problemFromTokenError(null)).toBe("unavailable");
  });
});

describe("mailboxProblemMessage", () => {
  const problems: MailboxProblem[] = ["not_connected", "scope_missing", "revoked", "unavailable"];

  it("names an action for every problem", () => {
    // A message that only says what failed leaves the host nowhere to go.
    for (const p of problems) {
      expect(mailboxProblemMessage(p)).toMatch(/connect|reconnect|try again/i);
    }
  });

  it("distinguishes connecting from reconnecting", () => {
    // Telling a connected member to "connect" sends them looking for a button
    // they already pressed.
    expect(mailboxProblemMessage("not_connected")).toMatch(/^Connect/);
    expect(mailboxProblemMessage("scope_missing")).toMatch(/^Reconnect/);
    expect(mailboxProblemMessage("scope_missing")).toMatch(/calendar but not email/);
  });

  it("never blames the organization", () => {
    // The old message said no mailbox was connected "for this organization",
    // which was both the wrong subject and unactionable for the member.
    for (const p of problems) {
      expect(mailboxProblemMessage(p)).not.toMatch(/organization/i);
    }
  });
});
