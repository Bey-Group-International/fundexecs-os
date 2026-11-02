const requestPrivacyAction = jest.fn();
jest.mock("@/app/lp/[token]/privacy-actions", () => ({ requestPrivacyAction: (...a: unknown[]) => requestPrivacyAction(...a) }));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LPDataRequest } from "./LPDataRequest";

beforeEach(() => requestPrivacyAction.mockReset());

describe("LPDataRequest", () => {
  it("offers both requests and sends nothing until one is confirmed", () => {
    render(<LPDataRequest token="tok" />);
    expect(screen.getByRole("button", { name: "Ask for a copy of my information" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for my information to be erased" })).toBeInTheDocument();
    expect(requestPrivacyAction).not.toHaveBeenCalled();
  });

  it("explains the erasure limit before sending, then sends the chosen kind and shows the answer", async () => {
    requestPrivacyAction.mockResolvedValue({ ok: true, message: "Your request has been sent to Acme." });
    render(<LPDataRequest token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for my information to be erased" }));
    expect(screen.getByText(/kept by law/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send erasure request" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your request has been sent to Acme."));
    expect(requestPrivacyAction).toHaveBeenCalledWith("tok", "erasure");
  });

  it("can be cancelled without sending", () => {
    render(<LPDataRequest token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for a copy of my information" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Send request" })).toBeNull();
    expect(requestPrivacyAction).not.toHaveBeenCalled();
  });

  it("shows a failure and keeps the form so the LP can try again", async () => {
    requestPrivacyAction.mockResolvedValue({ ok: false, error: "Couldn't send your request. Try again." });
    render(<LPDataRequest token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for a copy of my information" }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send your request"));
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument();
  });

  it("survives the call throwing", async () => {
    requestPrivacyAction.mockRejectedValue(new Error("network"));
    render(<LPDataRequest token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for a copy of my information" }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"));
  });
});
