const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const requestCode = jest.fn(async (_t: string): Promise<{ ok: true; sent: boolean; maskedEmail: string } | { ok: false; error: string }> => ({
  ok: true,
  sent: true,
  maskedEmail: "j•••@example.com",
}));
const verifyCode = jest.fn(async (_t: string, _c: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
jest.mock("@/app/lp/[token]/wizard-actions", () => ({
  requestAccessCodeAction: (t: string) => requestCode(t),
  verifyAccessCodeAction: (t: string, c: string) => verifyCode(t, c),
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { LPAccessGate } from "./LPAccessGate";

beforeEach(() => {
  refresh.mockClear();
  requestCode.mockClear();
  verifyCode.mockClear();
});

const ask = async () => {
  render(<LPAccessGate token="tok" maskedEmail="j•••@example.com" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  });
};

describe("LPAccessGate", () => {
  it("shows where the code will go, and asks for nothing until the LP asks for a code", () => {
    render(<LPAccessGate token="tok" maskedEmail="j•••@example.com" />);
    expect(screen.getByText("j•••@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  it("requests a code for this link, then shows the entry box", async () => {
    await ask();
    expect(requestCode).toHaveBeenCalledWith("tok");
    expect(screen.getByRole("status")).toHaveTextContent("Code sent to j•••@example.com");
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it("tells the LP to ask their fund manager when the email could not be sent", async () => {
    requestCode.mockResolvedValueOnce({ ok: true, sent: false, maskedEmail: "j•••@example.com" });
    await ask();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn.t send the email/);
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it("shows a refusal, such as the rate limit", async () => {
    requestCode.mockResolvedValueOnce({ ok: false, error: "A code was just sent." });
    await ask();
    expect(screen.getByRole("alert")).toHaveTextContent("A code was just sent.");
  });

  it("only enables Continue for six digits, then verifies and reloads the page", async () => {
    await ask();
    const button = screen.getByRole("button", { name: "Continue" });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123 45" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123 456" } });
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(verifyCode).toHaveBeenCalledWith("tok", "123 456");
    expect(refresh).toHaveBeenCalled();
  });

  it("stays put and says why when the code is wrong", async () => {
    verifyCode.mockResolvedValueOnce({ ok: false, error: "That code isn't right." });
    await ask();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "000000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("That code isn't right.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("can ask for a new code", async () => {
    await ask();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    });
    expect(requestCode).toHaveBeenCalledTimes(2);
  });
});
