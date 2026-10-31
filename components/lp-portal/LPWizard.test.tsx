const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type R = { ok: true } | { ok: false; error: string };
const ok = async (..._a: unknown[]): Promise<R> => ({ ok: true });
const saveDetails = jest.fn(ok);
const saveOwners = jest.fn(ok);
const grantConsent = jest.fn(ok);
const saveAccreditation = jest.fn(ok);
const submit = jest.fn(ok);
jest.mock("@/app/lp/[token]/wizard-actions", () => ({
  saveDetailsAction: (...a: unknown[]) => saveDetails(...a),
  saveOwnersAction: (...a: unknown[]) => saveOwners(...a),
  grantConsentAction: (...a: unknown[]) => grantConsent(...a),
  saveAccreditationAction: (...a: unknown[]) => saveAccreditation(...a),
  submitWizardAction: (...a: unknown[]) => submit(...a),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { LPWizard, type WizardInitial } from "./LPWizard";
import { CONSENT_SCOPES, CONSENT_TEXT_VERSION } from "@/lib/lp-wizard";

const blank: WizardInitial = {
  legalName: "",
  entityType: "",
  country: "",
  contactPhone: "",
  signatoryName: "",
  signatoryTitle: "",
  sourceOfFunds: "",
  accreditationBasis: "",
  accreditationStated: false,
  owners: [],
  consents: [],
};
const consented = CONSENT_SCOPES.map((scope) => ({ scope, textVersion: CONSENT_TEXT_VERSION, typedName: "Jo Park", consentedAt: "2026-10-31T00:00:00Z" }));
const finished: WizardInitial = {
  ...blank,
  legalName: "Jo Park",
  entityType: "individual",
  country: "US",
  sourceOfFunds: "Sale of my company in 2022",
  accreditationBasis: "accredited_investor",
  accreditationStated: true,
  consents: consented,
};

const wizard = (over: Partial<React.ComponentProps<typeof LPWizard>> = {}) =>
  render(<LPWizard token="tok" lpType="individual" ownerThresholdPct={25} changesRequested={false} initial={blank} {...over} />);
const click = async (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
const stepNames = () => screen.getAllByRole("listitem").map((li) => li.textContent);

beforeEach(() => {
  for (const m of [refresh, saveDetails, saveOwners, grantConsent, saveAccreditation, submit]) m.mockClear();
});

describe("the steps an LP sees", () => {
  it("skips the owners step for an individual and an institution", () => {
    wizard();
    expect(stepNames().join("|")).not.toMatch(/Owners/);
    expect(stepNames()).toHaveLength(4);
  });
  it("includes it for an entity", () => {
    wizard({ lpType: "entity" });
    expect(stepNames().join("|")).toMatch(/Owners/);
  });
  it("opens at the first step still to do, and marks finished ones", () => {
    wizard({ initial: { ...finished, sourceOfFunds: "", accreditationBasis: "", accreditationStated: false } });
    expect(screen.getByRole("heading", { name: /Accreditation and source of funds/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /✓ Your details/ })).toBeInTheDocument();
  });
  it("opens at review when everything is done", () => {
    wizard({ initial: finished });
    expect(screen.getByRole("heading", { name: "Review and submit" })).toBeInTheDocument();
    expect(screen.getByText("Everything is filled in.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });
  it("says so when the fund manager asked for changes", () => {
    wizard({ changesRequested: true });
    expect(screen.getByRole("status")).toHaveTextContent(/asked for more information/);
  });
});

describe("your details", () => {
  it("saves what was entered, then moves on", async () => {
    wizard();
    fireEvent.change(screen.getByLabelText("Legal name"), { target: { value: "Jo Park" } });
    fireEvent.change(screen.getByLabelText("Investor type"), { target: { value: "individual" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "US" } });
    await click("Save and continue");
    expect(saveDetails).toHaveBeenCalledWith("tok", expect.objectContaining({ legalName: "Jo Park", entityType: "individual", country: "US" }));
    expect(screen.getByRole("heading", { name: "Your consent" })).toBeInTheDocument();
  });
  it("asks entities and institutions for a signatory, and not individuals", () => {
    const { unmount } = wizard();
    expect(screen.queryByLabelText("Signatory name")).toBeNull();
    unmount();
    wizard({ lpType: "institutional" });
    expect(screen.getByLabelText("Signatory name")).toBeInTheDocument();
  });
  it("only offers investor types that fit", () => {
    wizard({ lpType: "institutional" });
    const options = Array.from((screen.getByLabelText("Investor type") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["", "pension", "endowment", "fund", "other"]);
  });
  it("stays on the step and shows the server's reason when it is refused", async () => {
    saveDetails.mockResolvedValueOnce({ ok: false, error: "Enter your full legal name." });
    wizard();
    await click("Save and continue");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your full legal name.");
    expect(screen.getByRole("heading", { name: "Your details" })).toBeInTheDocument();
  });
});

describe("owners", () => {
  const entity = { ...blank, legalName: "Acme LLC", entityType: "company" as const, country: "US", signatoryName: "Jo", signatoryTitle: "Manager" };
  it("explains the threshold the fund manager set", () => {
    wizard({ lpType: "entity", ownerThresholdPct: 10, initial: entity });
    expect(screen.getByText(/owns 10% or more/)).toBeInTheDocument();
  });
  it("sends everyone listed, with blank shares as null", async () => {
    wizard({ lpType: "entity", initial: entity });
    fireEvent.change(screen.getByLabelText("Person 1 name"), { target: { value: "Jo Park" } });
    await click("+ Add a person");
    fireEvent.change(screen.getByLabelText("Person 2 name"), { target: { value: "Sam Lee" } });
    fireEvent.change(screen.getByLabelText("Person 2 share"), { target: { value: "40" } });
    await click("Save and continue");
    expect(saveOwners).toHaveBeenCalledWith("tok", [
      { fullName: "Jo Park", role: "controller", ownershipPct: null, country: "" },
      { fullName: "Sam Lee", role: "owner", ownershipPct: "40", country: "" },
    ]);
  });
  it("lets a person be removed, but never the last one", async () => {
    wizard({ lpType: "entity", initial: entity });
    expect(screen.getByRole("button", { name: "Remove person 1" })).toBeDisabled();
    await click("+ Add a person");
    await click("Remove person 2");
    expect(screen.queryByLabelText("Person 2 name")).toBeNull();
  });
});

describe("consent", () => {
  const atConsent = { ...blank, legalName: "Jo Park", entityType: "individual" as const, country: "US" };
  it("records each consent with the typed name, and shows it given", async () => {
    wizard({ initial: atConsent });
    await click("I agree: Identity verification");
    expect(grantConsent).toHaveBeenCalledWith("tok", { scope: "identity_verification", typedName: "Jo Park" });
    expect(screen.getByText("✓ Consent given by Jo Park")).toBeInTheDocument();
    expect(grantConsent).toHaveBeenCalledTimes(1);
  });
  it("will not record a consent without a typed name", () => {
    wizard({ initial: atConsent });
    fireEvent.change(screen.getByLabelText("Identity verification typed name"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "I agree: Identity verification" })).toBeDisabled();
  });
  it("does not treat a consent to older wording as given", () => {
    wizard({ initial: { ...atConsent, consents: consented.map((c) => ({ ...c, textVersion: "2020-01-01" })) } });
    expect(screen.queryByText(/Consent given by/)).toBeNull();
    expect(screen.getByRole("button", { name: "I agree: Identity verification" })).toBeInTheDocument();
  });
});

describe("accreditation", () => {
  const atAccreditation = { ...finished, sourceOfFunds: "", accreditationBasis: "" as const, accreditationStated: false };
  it("sends the basis, the confirmation and the source of funds", async () => {
    wizard({ initial: atAccreditation });
    fireEvent.click(screen.getByLabelText("Qualified purchaser"));
    fireEvent.change(screen.getByLabelText("Source of funds"), { target: { value: "Sale of my company in 2022" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await click("Save and continue");
    expect(saveAccreditation).toHaveBeenCalledWith("tok", { basis: "qualified_purchaser", statement: true, sourceOfFunds: "Sale of my company in 2022" });
    expect(screen.getByRole("heading", { name: "Review and submit" })).toBeInTheDocument();
  });
  it("shows the reason when the statement is refused", async () => {
    saveAccreditation.mockResolvedValueOnce({ ok: false, error: "Confirm the statement to continue." });
    wizard({ initial: atAccreditation });
    await click("Save and continue");
    expect(screen.getByRole("alert")).toHaveTextContent("Confirm the statement");
  });
});

describe("review and submit", () => {
  it("lists what is still to do and will not submit", () => {
    wizard({ initial: { ...finished, consents: [] } });
    fireEvent.click(screen.getByRole("button", { name: /Review and submit/ }));
    expect(screen.getByText("Still to do:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  });
  it("jumps to a step that is still to do", () => {
    wizard({ initial: { ...finished, consents: [] } });
    fireEvent.click(screen.getByRole("button", { name: /Review and submit/ }));
    const list = screen.getByText("Still to do:").parentElement!;
    fireEvent.click(list.querySelector("button")!);
    expect(screen.getByRole("heading", { name: "Your consent" })).toBeInTheDocument();
  });
  it("submits, then reloads to show the under-review page", async () => {
    wizard({ initial: finished });
    await click("Submit for review");
    expect(submit).toHaveBeenCalledWith("tok");
    expect(refresh).toHaveBeenCalled();
  });
  it("shows a refusal and does not reload", async () => {
    submit.mockResolvedValueOnce({ ok: false, error: "Finish these first: Consent." });
    wizard({ initial: finished });
    await click("Submit for review");
    expect(screen.getByRole("alert")).toHaveTextContent("Finish these first");
    expect(refresh).not.toHaveBeenCalled();
  });
});
