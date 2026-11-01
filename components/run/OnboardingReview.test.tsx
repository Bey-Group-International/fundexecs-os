const recordCheck = jest.fn(async (_input: unknown): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
const refreshIdentity = jest.fn(async (_id: string): Promise<{ ok: true; verified?: boolean } | { ok: false; error: string }> => ({ ok: true, verified: true }));
const runOfac = jest.fn(async (_id: string): Promise<{ ok: true; flagged?: number; screened?: number; wrote?: boolean } | { ok: false; error: string }> => ({ ok: true, flagged: 0, screened: 2, wrote: true }));
const recordDecision = jest.fn(async (_input: unknown): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
jest.mock("@/app/(app)/[hub]/[module]/onboarding-actions", () => ({
  recordOnboardingCheck: (i: unknown) => recordCheck(i),
  recordOnboardingDecision: (i: unknown) => recordDecision(i),
  refreshIdentityCheckAction: (id: string) => refreshIdentity(id),
  runOfacScreenAction: (id: string) => runOfac(id),
}));

const emailLink = jest.fn(async (_id: string): Promise<{ ok: true; sent: boolean } | { ok: false; error: string }> => ({ ok: true, sent: true }));
const makeCode = jest.fn(async (_id: string): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> => ({
  ok: true,
  code: "482913",
  expiresAt: "2099-01-01T00:00:00Z",
}));
jest.mock("@/app/(app)/[hub]/[module]/onboarding-link-actions", () => ({
  emailLpLinkAction: (id: string) => emailLink(id),
  generateAccessCodeAction: (id: string) => makeCode(id),
}));

// inputClass comes from a module that also holds server actions; the build tests mock it the same way.
jest.mock("@/components/build/actions", () => ({}));

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { OnboardingReview, type ReviewLp } from "./OnboardingReview";

const FUTURE = "2099-01-01T00:00:00Z";
const REQUIRED = ["identity", "sanctions", "pep", "adverse_media", "accreditation"] as const;
const clear = (kind: (typeof REQUIRED)[number]) => ({ kind, status: "clear" as const, summary: null, checkedAt: "2026-10-30T00:00:00Z", expiresAt: FUTURE });

const lp = (over: Partial<ReviewLp> = {}): ReviewLp => ({
  id: "s1",
  lpName: "Calpers Pension",
  lpEmail: "ops@calpers.ca.gov",
  stageLabel: "Accreditation",
  reviewState: "submitted",
  token: "tok-123",
  expiresAt: FUTURE,
  submission: { lpType: "individual", ownerThresholdPct: 25, profile: null, owners: [], consents: [] },
  checks: [],
  decisions: [],
  activity: [],
  ...over,
});

const open = () => fireEvent.click(screen.getByRole("button", { name: /Calpers Pension/ }));

beforeEach(() => {
  runOfac.mockClear();
  refreshIdentity.mockClear();
  emailLink.mockClear();
  makeCode.mockClear();
  recordCheck.mockClear();
  recordDecision.mockClear();
});

describe("an LP card", () => {
  it("counts what is left to resolve, and shows the stage", () => {
    render(<OnboardingReview lps={[lp({ checks: [clear("identity")] })]} />);
    expect(screen.getByText("4 to resolve")).toBeInTheDocument();
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
  });

  it("shows the onboarding stage once the LP is approved, and the review state before that", () => {
    const { rerender } = render(<OnboardingReview lps={[lp({ reviewState: "approved" })]} />);
    expect(screen.getByText("Accreditation")).toBeInTheDocument();
    rerender(<OnboardingReview lps={[lp({ reviewState: "in_progress" })]} />);
    expect(screen.queryByText("Accreditation")).toBeNull();
  });

  it("says when every required check is clear, and shows the latest decision", () => {
    render(
      <OnboardingReview
        lps={[lp({ checks: REQUIRED.map(clear), decisions: [{ id: "d1", decision: "approved", reason: "All clear", decidedAt: "2026-10-30T00:00:00Z" }] })]}
      />,
    );
    expect(screen.getByText("Checks clear")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("opens to every check, the decision form, and the history", () => {
    render(
      <OnboardingReview
        lps={[
          lp({
            decisions: [{ id: "d1", decision: "more_info", reason: "Need the trust deed", decidedAt: "2026-10-30T00:00:00Z" }],
            activity: [{ id: 1, text: "Identity check recorded as clear", at: "2026-10-30T00:00:00Z" }],
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
    open();
    for (const label of ["Identity", "Sanctions", "Politically exposed", "Adverse media", "Accreditation", "Litigation"]) {
      expect(screen.getByLabelText(`${label} status`)).toBeInTheDocument();
    }
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeInTheDocument();
    expect(screen.getByText(/Need the trust deed/)).toBeInTheDocument();
    expect(screen.getByText(/Identity check recorded as clear/)).toBeInTheDocument();
  });

  it("marks a clearance that has run out", () => {
    render(<OnboardingReview lps={[lp({ checks: [{ ...clear("identity"), expiresAt: "2020-01-01T00:00:00Z" }] })]} />);
    open();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});

describe("recording a check", () => {
  it("saves status, note and validity for that check", async () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    fireEvent.change(screen.getByLabelText("Identity status"), { target: { value: "clear" } });
    fireEvent.change(screen.getByLabelText("Identity note"), { target: { value: "ID matched" } });
    fireEvent.change(screen.getByLabelText("Identity valid for"), { target: { value: "90" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Identity" }));
    });
    expect(recordCheck).toHaveBeenCalledWith({ sessionId: "s1", kind: "identity", status: "clear", summary: "ID matched", validForDays: 90 });
    expect(screen.getAllByText("Saved.")).toHaveLength(1);
  });

  it("offers an expiry only on a clearance", () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    expect(screen.getByLabelText("Sanctions valid for")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sanctions status"), { target: { value: "clear" } });
    expect(screen.getByLabelText("Sanctions valid for")).toBeEnabled();
  });

  it("shows why a save was refused", async () => {
    recordCheck.mockResolvedValueOnce({ ok: false, error: "Say what was found. A flagged or failed check needs a note." });
    render(<OnboardingReview lps={[lp()]} />);
    open();
    fireEvent.change(screen.getByLabelText("Sanctions status"), { target: { value: "flagged" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Sanctions" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("needs a note");
  });
});

describe("recording a decision", () => {
  it("explains what blocks an approval and will not send one", () => {
    render(<OnboardingReview lps={[lp({ checks: [clear("identity")] })]} />);
    open();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "approved" } });
    expect(screen.getByText(/Can't approve yet\. not done: Sanctions, Politically exposed, Adverse media, Accreditation/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeDisabled();
  });

  it("allows approval once everything required is clear", async () => {
    render(<OnboardingReview lps={[lp({ checks: REQUIRED.map(clear) })]} />);
    open();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "approved" } });
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "All checks clear" } });
    expect(screen.queryByText(/Can't approve yet/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    });
    expect(recordDecision).toHaveBeenCalledWith({ sessionId: "s1", decision: "approved", reason: "All checks clear" });
    expect(screen.getByText("Decision recorded.")).toBeInTheDocument();
    expect(screen.getByLabelText("Reasoning")).toHaveValue("");
  });

  it("lets an LP be rejected without every check done", async () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "rejected" } });
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "Could not verify source of funds" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    });
    expect(recordDecision).toHaveBeenCalledWith({ sessionId: "s1", decision: "rejected", reason: "Could not verify source of funds" });
  });

  it("shows why a decision was refused", async () => {
    recordDecision.mockResolvedValueOnce({ ok: false, error: "Give your reasoning. It is recorded with the decision." });
    render(<OnboardingReview lps={[lp()]} />);
    open();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "rejected" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    });
    expect(within(screen.getByRole("alert")).getByText(/Give your reasoning/)).toBeInTheDocument();
  });
});

describe("the decision follows the LP's stage", () => {
  const options = () => within(screen.getByLabelText("Decision")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

  it("offers every decision once the LP has submitted", () => {
    render(<OnboardingReview lps={[lp({ reviewState: "submitted" })]} />);
    open();
    expect(options().sort()).toEqual(["approved", "more_info", "rejected"]);
  });

  it.each(["not_started", "in_progress", "changes_requested"] as const)("only allows rejecting an LP who is %s", (reviewState) => {
    render(<OnboardingReview lps={[lp({ reviewState })]} />);
    open();
    expect(options()).toEqual(["rejected"]);
  });

  it.each(["approved", "rejected"] as const)("offers nothing once the LP is %s", (reviewState) => {
    render(<OnboardingReview lps={[lp({ reviewState })]} />);
    open();
    expect(screen.queryByRole("button", { name: "Record decision" })).toBeNull();
  });
});

describe("the LP's link", () => {
  it("is offered while the LP is still undecided", () => {
    render(<OnboardingReview lps={[lp({ reviewState: "in_progress" })]} />);
    open();
    expect(screen.getByText(/The LP.s link/)).toBeInTheDocument();
  });

  it.each(["approved", "rejected"] as const)("is not offered once the LP is %s", (reviewState) => {
    render(<OnboardingReview lps={[lp({ reviewState })]} />);
    open();
    expect(screen.queryByText(/The LP.s link/)).toBeNull();
  });

  it("emails the link, and says when it could not be sent", async () => {
    render(<OnboardingReview lps={[lp({ reviewState: "not_started" })]} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /email/i }));
    });
    expect(emailLink).toHaveBeenCalledWith("s1");
    expect(screen.getByText("Link emailed to the LP.")).toBeInTheDocument();

    emailLink.mockResolvedValueOnce({ ok: true, sent: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /email/i }));
    });
    expect(screen.getByText(/couldn.t be sent/)).toBeInTheDocument();
  });

  it("says when the LP was last sent a reminder", () => {
    render(<OnboardingReview lps={[lp({ reviewState: "in_progress", remindedAt: "2026-11-04T10:00:00Z" })]} />);
    open();
    expect(screen.getByText(/Reminder emailed Nov 4, 2026/)).toBeInTheDocument();
  });

  it("says nothing about reminders before one has been sent", () => {
    render(<OnboardingReview lps={[lp({ reviewState: "in_progress" })]} />);
    open();
    expect(screen.queryByText(/Reminder emailed/)).toBeNull();
  });

  it("says when the link has expired and stops offering to send it", () => {
    render(<OnboardingReview lps={[lp({ reviewState: "not_started", expiresAt: "2020-01-01T00:00:00Z" })]} />);
    open();
    expect(screen.getByText(/has expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /code/i })).toBeDisabled();
  });

  it("shows a one-time code to read out", async () => {
    render(<OnboardingReview lps={[lp({ reviewState: "not_started" })]} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /code/i }));
    });
    expect(makeCode).toHaveBeenCalledWith("s1");
    expect(screen.getByText("482913")).toBeInTheDocument();
  });
});

describe("what the LP submitted", () => {
  const submission = {
    lpType: "entity" as const,
    ownerThresholdPct: 25,
    profile: {
      legalName: "Acme Holdings LLC",
      entityType: "company" as const,
      country: "US",
      contactPhone: null,
      signatoryName: "Jo Park",
      signatoryTitle: "Manager",
      sourceOfFunds: "Proceeds from the sale of a business",
      accreditationBasis: null,
      accreditationStatedAt: null,
    },
    owners: [{ id: "o1", fullName: "Jo Park", role: "controller" as const, ownershipPct: null, country: "US" }],
    consents: [],
  };

  it("shows their statements and warns when nobody meets the ownership threshold", () => {
    render(<OnboardingReview lps={[lp({ submission })]} />);
    open();
    expect(screen.getByText("Acme Holdings LLC")).toBeInTheDocument();
    expect(screen.getByText("Proceeds from the sale of a business")).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });

  it("shows nothing when the LP has not entered anything", () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    expect(screen.queryByText("What the LP submitted")).toBeNull();
  });
});

describe("an ID check from Stripe Identity", () => {
  const stripeCheck = (status: "pending" | "clear") => ({ ...clear("identity"), status, method: "stripe_identity" as const, summary: "Waiting for the LP." });

  it("is labelled, and can be refreshed while pending", async () => {
    render(<OnboardingReview lps={[lp({ checks: [stripeCheck("pending")] })]} />);
    open();
    expect(screen.getByText("Stripe Identity")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh Stripe result" }));
    });
    expect(refreshIdentity).toHaveBeenCalledWith("s1");
    expect(screen.getByText("Verified by Stripe.")).toBeInTheDocument();
  });

  it("says when Stripe has no final result yet", async () => {
    refreshIdentity.mockResolvedValueOnce({ ok: true, verified: false });
    render(<OnboardingReview lps={[lp({ checks: [stripeCheck("pending")] })]} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh Stripe result" }));
    });
    expect(screen.getByText(/Not verified yet/)).toBeInTheDocument();
  });

  it("shows why a refresh failed", async () => {
    refreshIdentity.mockResolvedValueOnce({ ok: false, error: "We couldn't reach the verification service." });
    render(<OnboardingReview lps={[lp({ checks: [stripeCheck("pending")] })]} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh Stripe result" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't reach");
  });

  it("has no refresh once settled, and none for a check recorded by hand", () => {
    const { unmount } = render(<OnboardingReview lps={[lp({ checks: [stripeCheck("clear")] })]} />);
    open();
    expect(screen.queryByRole("button", { name: "Refresh Stripe result" })).toBeNull();
    unmount();
    render(<OnboardingReview lps={[lp({ checks: [{ ...clear("identity"), status: "pending", method: "manual" }] })]} />);
    open();
    expect(screen.queryByText("Stripe Identity")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh Stripe result" })).toBeNull();
  });
});

describe("the OFAC first-pass screen on the sanctions check", () => {
  const run = async () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run OFAC screen" }));
    });
  };

  it("is offered on the sanctions check only, and says it flags without clearing", () => {
    render(<OnboardingReview lps={[lp()]} />);
    open();
    expect(screen.getAllByRole("button", { name: "Run OFAC screen" })).toHaveLength(1);
    expect(screen.getByText(/It flags; it never clears/)).toBeInTheDocument();
  });

  it("runs the screen for this LP, and says a clean result is not a clearance", async () => {
    await run();
    expect(runOfac).toHaveBeenCalledWith("s1");
    expect(screen.getByText(/No possible match\. This is not a clearance/)).toBeInTheDocument();
  });

  it("says when names were flagged", async () => {
    runOfac.mockResolvedValueOnce({ ok: true, flagged: 2, screened: 3, wrote: true });
    await run();
    expect(screen.getByRole("alert")).toHaveTextContent("2 possible matches flagged");
  });

  it("says a result the fund manager recorded was left alone", async () => {
    runOfac.mockResolvedValueOnce({ ok: true, flagged: 1, screened: 2, wrote: false });
    await run();
    expect(screen.getByRole("alert")).toHaveTextContent("your recorded result was left as it is");
  });

  it("shows why it couldn't run", async () => {
    runOfac.mockResolvedValueOnce({ ok: false, error: "Couldn't get OFAC's list just now." });
    await run();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't get OFAC's list");
  });
});
