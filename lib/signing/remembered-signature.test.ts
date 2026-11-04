/** @jest-environment jsdom */
import { forgetSignature, loadRememberedSignature, rememberSignature } from "./remembered-signature";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(() => window.localStorage.clear());

describe("a signature kept on this device", () => {
  it("is stored per user and read back", () => {
    expect(loadRememberedSignature("u1")).toBeNull();
    expect(rememberSignature("u1", PNG)).toBe(true);
    expect(loadRememberedSignature("u1")).toBe(PNG);
    expect(loadRememberedSignature("u2")).toBeNull();
  });

  it("can be forgotten", () => {
    rememberSignature("u1", PNG);
    forgetSignature("u1");
    expect(loadRememberedSignature("u1")).toBeNull();
  });

  it("refuses anything that is not a small PNG, and ignores a tampered stored value", () => {
    expect(rememberSignature("u1", "data:text/html;base64,PGI+")).toBe(false);
    expect(rememberSignature("u1", PNG + "A".repeat(200_000))).toBe(false);
    window.localStorage.setItem("fundexecs:signature:u1", "javascript:alert(1)");
    expect(loadRememberedSignature("u1")).toBeNull();
  });

  it("acts as if nothing is remembered when storage is blocked", () => {
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadRememberedSignature("u1")).toBeNull();
    spy.mockRestore();
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(rememberSignature("u1", PNG)).toBe(false);
    set.mockRestore();
  });
});
