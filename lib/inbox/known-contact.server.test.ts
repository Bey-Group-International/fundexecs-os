import { isKnownContact } from "./known-contact.server";

function client(rows: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "limit"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [] }).then(resolve);
      return b;
    },
  } as never;
}

it("knows a CRM contact the firm has already written to", async () => {
  const c = client({ network_contacts: [{ id: "c1" }], inbox_threads: [{ id: "t1" }], inbox_messages: [{ id: "m1" }] });
  expect(await isKnownContact(c, "org", "Ana@Acme.com")).toBe(true);
});

it("does not know a new address, a contact never written to, or no address", async () => {
  expect(await isKnownContact(client({ inbox_threads: [{ id: "t1" }], inbox_messages: [{ id: "m1" }] }), "org", "a@b.co")).toBe(false);
  expect(await isKnownContact(client({ network_contacts: [{ id: "c1" }], inbox_threads: [{ id: "t1" }] }), "org", "a@b.co")).toBe(false);
  expect(await isKnownContact(client({}), "org", null)).toBe(false);
});
