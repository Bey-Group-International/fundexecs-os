import { randomBytes } from "crypto";
import { isEncrypted } from "@/lib/crypto/field-encryption";
import { openProfileRow, sealProfileWrite } from "@/lib/lp-pii";

describe("lp-pii", () => {
  const OLD = process.env.FIELD_ENCRYPTION_KEYS;
  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString("base64")}`;
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.FIELD_ENCRYPTION_KEYS;
    else process.env.FIELD_ENCRYPTION_KEYS = OLD;
  });

  it("seals only the sealed columns that are present", () => {
    const out = sealProfileWrite("s1", { contact_phone: "+44 20 7946 0000" });
    expect(isEncrypted(out.contact_phone)).toBe(true);
    expect(Object.keys(out)).toEqual(["contact_phone"]);
  });

  it("round-trips a profile row and leaves other columns alone", () => {
    const sealed = sealProfileWrite("s1", { contact_phone: "+44 20 7946 0000", source_of_funds: "Sale of a business in 2021" });
    const row = { session_id: "s1", legal_name: "Ada Lovelace", ...sealed };
    expect(openProfileRow(row)).toEqual({
      session_id: "s1",
      legal_name: "Ada Lovelace",
      contact_phone: "+44 20 7946 0000",
      source_of_funds: "Sale of a business in 2021",
    });
  });

  it("does not open a row copied under a different session", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const sealed = sealProfileWrite("s1", { contact_phone: "+44 20 7946 0000" });
    expect(openProfileRow({ session_id: "s2", ...sealed }).contact_phone).toBeNull();
  });

  it("passes legacy plaintext through", () => {
    expect(openProfileRow({ session_id: "s1", contact_phone: "555-0100" }).contact_phone).toBe("555-0100");
  });
});
