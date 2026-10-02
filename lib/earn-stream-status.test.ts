import { encodeStatus, StatusStreamParser } from "@/lib/earn-stream-status";

describe("status framing", () => {
  it("separates status notes from answer text", () => {
    const p = new StatusStreamParser();
    expect(p.push(`${encodeStatus("Reading Atlas…")}Hello`)).toEqual({ text: "Hello", status: "Reading Atlas…" });
    expect(p.push(" world")).toEqual({ text: " world", status: null });
  });

  it("holds a frame split across chunks", () => {
    const p = new StatusStreamParser();
    const framed = `Before${encodeStatus("Searching the web…")}After`;
    const cut = framed.indexOf("web");
    expect(p.push(framed.slice(0, cut))).toEqual({ text: "Before", status: null });
    expect(p.push(framed.slice(cut))).toEqual({ text: "After", status: "Searching the web…" });
  });

  it("keeps the latest of several notes in one chunk", () => {
    const p = new StatusStreamParser();
    expect(p.push(`${encodeStatus("one")}${encodeStatus("two")}x`)).toEqual({ text: "x", status: "two" });
  });

  it("strips control characters out of the note itself", () => {
    expect(encodeStatus("a\u0003b")).toBe("\u0002ab\u0003");
  });
});
