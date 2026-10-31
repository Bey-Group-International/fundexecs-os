const recordCheck = jest.fn(async (_input: unknown): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
const recordDecision = jest.fn(async (_input: unknown): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
jest.mock("@/app/(app)/[hub]/[module]/onboarding-actions", () => ({
  recordOnboardingCheck: (i: unknown) => recordCheck(i),
  recordOnboardingDecision: (i: unknown) => recordDecision(i),
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
  checks: [],
  decisions: [],
  activity: [],
  ...over,
});

const open = () => fireEvent.click(screen.getByRole("button", { name: /Calpers Pension/ }));

beforeEach(() => {
  recordCheck.mockClear();
  recordDecision.mockClear();
});

describe("an LP card", () => {
  it("counts what is left to resolve, and shows the stage", () => {
    render(<OnboardingReview lps={[lp({ checks: [clear("identity")] })]} />);
    expect(screen.getByText("4 to resolve")).toBeInTheDocument();
    expect(screen.getByText("Accreditation")).toBeInTheDocument();
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    });
    expect(within(screen.getByRole("alert")).getByText(/Give your reasoning/)).toBeInTheDocument();
  });
});
