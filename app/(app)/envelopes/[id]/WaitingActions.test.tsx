import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WaitingActions } from "./WaitingActions";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } });
});

describe("WaitingActions", () => {
  it("resends and says who it went to", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, sentTo: ["jane@lp.com"] }) })) as unknown as typeof fetch;
    render(<WaitingActions envelopeId="e1" readerName="Jane" signingToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend to Jane" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("jane@lp.com"));
    expect(global.fetch).toHaveBeenCalledWith("/api/envelopes/e1/resend", { method: "POST" });
  });

  it("shows why a reminder could not be sent", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ ok: false, error: "You just sent a reminder." }) })) as unknown as typeof fetch;
    render(<WaitingActions envelopeId="e1" readerName="Jane" signingToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend to Jane" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("just sent"));
  });

  it("copies the reader's own link, and offers no link for an LP", async () => {
    const { unmount } = render(<WaitingActions envelopeId="e1" readerName="Jane" signingToken="tok" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/sign/tok`));
    unmount();
    render(<WaitingActions envelopeId="e1" readerName="Jane" signingToken={null} />);
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});
