/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const action = jest.fn();
jest.mock("@/components/build/countersign-room-actions", () => ({
  countersignRoomDocumentAction: (...a: unknown[]) => action(...a),
}));
jest.mock("@/components/signing/SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (p: string | null) => void }) => (
    <button type="button" onClick={() => onChange("data:image/png;base64,AAAA")}>draw</button>
  ),
}));

import { CountersignForm } from "./CountersignForm";

beforeEach(() => action.mockReset());

function fill() {
  fireEvent.click(screen.getByRole("button", { name: /counter-sign side letter/i }));
  fireEvent.change(screen.getByLabelText("Your full name"), { target: { value: "Fund Admin" } });
  fireEvent.click(screen.getByText("draw"));
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("CountersignForm", () => {
  it("stays closed until asked, and cannot submit until name, signature and consent are given", () => {
    render(<CountersignForm signatureId="s1" fileName="side letter" />);
    expect(screen.queryByLabelText("Your full name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /counter-sign side letter/i }));
    expect(screen.getAllByRole("button", { name: "Counter-sign" })[0]).toBeDisabled();
  });

  it("submits the name, signature and consent for this signature", async () => {
    action.mockResolvedValue({ ok: true });
    render(<CountersignForm signatureId="s1" fileName="side letter" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Counter-sign" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("s1", "Fund Admin", "data:image/png;base64,AAAA", true));
  });

  it("shows why it failed", async () => {
    action.mockResolvedValue({ ok: false, error: "This has already been counter-signed." });
    render(<CountersignForm signatureId="s1" fileName="side letter" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Counter-sign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already been counter-signed");
  });
});
