const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const create = jest.fn(
  async (_i: unknown): Promise<{ ok: true; sessionId: string; url: string; carried: Array<{ kind: string; checkedAt: string; expiresAt: string; namesMatch?: boolean }> } | { ok: false; error: string }> => ({
    ok: true,
    sessionId: "s9",
    url: "https://app.example.com/lp/tok-abc",
    carried: [],
  }),
);
const email = jest.fn(async (_id: string): Promise<{ ok: true; sent: boolean; detail: string } | { ok: false; error: string }> => ({ ok: true, sent: true, detail: "" }));
jest.mock("@/app/(app)/[hub]/[module]/onboarding-link-actions", () => ({
  createLpLinkAction: (i: unknown) => create(i),
  emailLpLinkAction: (id: string) => email(id),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { NewLpLink } from "./NewLpLink";

const funds = [{ id: "f1", name: "Fund I" }];

beforeEach(() => {
  refresh.mockClear();
  create.mockClear();
  email.mockClear();
});

const openForm = () => {
  render(<NewLpLink funds={funds} />);
  fireEvent.click(screen.getByRole("button", { name: "+ New LP link" }));
};
const fill = () => {
  fireEvent.change(screen.getByLabelText("LP name"), { target: { value: "Calpers" } });
  fireEvent.change(screen.getByLabelText("LP email"), { target: { value: "ops@calpers.ca.gov" } });
};
const make = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Make link" }));
  });

describe("NewLpLink", () => {
  it("starts closed", () => {
    render(<NewLpLink funds={funds} />);
    expect(screen.queryByLabelText("LP name")).toBeNull();
  });

  it("makes the link from the LP's details", async () => {
    openForm();
    fill();
    fireEvent.change(screen.getByLabelText("Kind of LP"), { target: { value: "institutional" } });
    fireEvent.change(screen.getByLabelText("Fund"), { target: { value: "f1" } });
    fireEvent.change(screen.getByLabelText("Commitment"), { target: { value: "250000" } });
    await make();
    expect(create).toHaveBeenCalledWith({
      lpName: "Calpers",
      lpEmail: "ops@calpers.ca.gov",
      lpType: "institutional",
      ownerThresholdPct: undefined,
      fundId: "f1",
      commitmentAmount: "250000",
    });
    expect(screen.getByText("https://app.example.com/lp/tok-abc")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("offers the ownership threshold only for entities, defaulting to 25%", async () => {
    openForm();
    expect(screen.queryByLabelText("Ownership threshold")).toBeNull();
    fireEvent.change(screen.getByLabelText("Kind of LP"), { target: { value: "entity" } });
    expect(screen.getByLabelText("Ownership threshold")).toHaveValue("25");
    fill();
    fireEvent.change(screen.getByLabelText("Ownership threshold"), { target: { value: "10" } });
    await make();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lpType: "entity", ownerThresholdPct: "10" }));
  });

  it("shows why a link could not be made, and keeps the form", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "Enter a valid email address for the LP." });
    openForm();
    fill();
    await make();
    expect(screen.getByRole("alert")).toHaveTextContent("valid email");
    expect(screen.getByLabelText("LP name")).toHaveValue("Calpers");
  });

  it("emails the link, and says when it could not be sent", async () => {
    openForm();
    fill();
    await make();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Email it for me" }));
    });
    expect(email).toHaveBeenCalledWith("s9");
    expect(screen.getByRole("status")).toHaveTextContent("Link emailed to ops@calpers.ca.gov.");

    email.mockResolvedValueOnce({ ok: true, sent: false, detail: "" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Email it for me" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t be sent/);
  });

  it("copies the link", async () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    openForm();
    fill();
    await make();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/lp/tok-abc");
  });

  it("says nothing about earlier verification for a new LP", async () => {
    openForm();
    fill();
    await make();
    expect(screen.queryByText(/not used yet/)).toBeNull();
  });

  it("tells the fund manager an earlier ID check is waiting for their confirmation, and is NOT used yet", async () => {
    create.mockResolvedValueOnce({
      ok: true,
      sessionId: "s9",
      url: "https://app.example.com/lp/tok-abc",
      carried: [{ kind: "identity", checkedAt: "2026-07-24T00:00:00Z", expiresAt: "2027-07-24T00:00:00Z", namesMatch: true }],
    });
    openForm();
    fill();
    await make();
    expect(screen.getByRole("status")).toHaveTextContent(/ID check of Jul 2[34], 2026/);
    expect(screen.getByRole("status")).toHaveTextContent(/not used yet/);
    expect(screen.getByRole("status")).toHaveTextContent(/confirm it is the same person/);
    expect(screen.getByRole("status")).not.toHaveTextContent(/names .* differ/);
  });

  it("warns when the names on the two onboardings differ", async () => {
    create.mockResolvedValueOnce({
      ok: true,
      sessionId: "s9",
      url: "https://app.example.com/lp/tok-abc",
      carried: [{ kind: "identity", checkedAt: "2026-07-24T00:00:00Z", expiresAt: "2027-07-24T00:00:00Z", namesMatch: false }],
    });
    openForm();
    fill();
    await make();
    expect(screen.getByRole("status")).toHaveTextContent(/names on the two onboardings differ/);
  });

  it("starts over for another LP", async () => {
    openForm();
    fill();
    await make();
    fireEvent.click(screen.getByRole("button", { name: "Make another" }));
    expect(screen.getByLabelText("LP name")).toHaveValue("");
  });
});
