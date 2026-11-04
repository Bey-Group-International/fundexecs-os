import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SignaturePad } from "./SignaturePad";

// jsdom has no canvas: a stand-in that records what is drawn and with which face.
const draws: { font: string; text: string }[] = [];
let loadFont: jest.Mock;

beforeEach(() => {
  draws.length = 0;
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    measureText: () => ({ width: 100 }),
    fillText(text: string) {
      draws.push({ font: (this as { font: string }).font, text });
    },
    font: "",
    fillStyle: "",
    textBaseline: "",
  })) as never;
  HTMLCanvasElement.prototype.toDataURL = jest.fn(() => "data:image/png;base64,AAAA");
  loadFont = jest.fn(async () => []);
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: loadFont } });
  document.documentElement.style.setProperty("--font-signature", "'__Dancing_Script_x1', '__Dancing_Script_Fallback_x1'");
});

describe("SignaturePad typed signature", () => {
  it("waits for the script face before drawing, then draws in it", async () => {
    const onChange = jest.fn();
    render(<SignaturePad signerName="Jane Smith" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    await act(async () => {});
    expect(loadFont).toHaveBeenCalledWith(expect.stringContaining("__Dancing_Script_x1"), "Jane Smith");
    expect(draws).toHaveLength(1);
    expect(draws[0].font).toContain("__Dancing_Script_x1");
    expect(draws[0].text).toBe("Jane Smith");
    expect(onChange).toHaveBeenLastCalledWith("data:image/png;base64,AAAA");
  });

  it("does not draw an earlier keystroke over a later one", async () => {
    const onChange = jest.fn();
    let release: (() => void) | undefined;
    loadFont.mockImplementationOnce(() => new Promise<unknown[]>((res) => (release = () => res([]))));
    render(<SignaturePad signerName="Jane" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Type" })); // starts a slow font load for "Jane"
    fireEvent.change(screen.getByPlaceholderText("Type your full name"), { target: { value: "Janet" } });
    await act(async () => {
      release?.();
    });
    expect(draws.map((d) => d.text)).toEqual(["Janet"]);
  });

  it("offers Draw, Type and Upload", () => {
    render(<SignaturePad signerName="Jane" onChange={() => undefined} />);
    for (const t of ["Draw", "Type", "Upload"]) expect(screen.getByRole("button", { name: t })).toBeTruthy();
  });
});
