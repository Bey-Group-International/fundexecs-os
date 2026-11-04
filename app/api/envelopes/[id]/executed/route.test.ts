jest.mock("server-only", () => ({}), { virtual: true });

let user: { id: string } | null;
let copy: { pdf: Uint8Array; title: string; executed: boolean; kept: boolean } | null;
let tokenOk = true;
const getCopy = jest.fn(async () => copy);
jest.mock("@/lib/signing/executed-envelope.server", () => ({ getEnvelopeCopy: (...a: unknown[]) => (getCopy as (...x: unknown[]) => unknown)(...a) }));
jest.mock("@/lib/envelope-notify.server", () => ({ envelopeCopyTokenValid: () => tokenOk }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ kind: "service" }),
  createServerClient: async () => ({ kind: "member", auth: { getUser: async () => ({ data: { user } }) } }),
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (qs = "") => GET(new Request(`http://x/executed${qs}`), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  user = { id: "u" };
  tokenOk = true;
  getCopy.mockClear();
  copy = { pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]), title: "Subscription Agreement", executed: true, kept: true };
});

describe("GET /api/envelopes/[id]/executed", () => {
  it("lets a member download the executed copy under their own access", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("Subscription-Agreement-executed.pdf");
    expect((getCopy.mock.calls[0] as unknown[])[0]).toMatchObject({ kind: "member" });
  });

  it("lets the holder of the emailed link download it, with the service client", async () => {
    user = null;
    const res = await call("?t=abc");
    expect(res.status).toBe(200);
    expect((getCopy.mock.calls[0] as unknown[])[0]).toMatchObject({ kind: "service" });
  });

  it("names a partly signed copy as signed-so-far", async () => {
    copy = { ...copy!, executed: false, kept: false };
    expect((await call()).headers.get("Content-Disposition")).toContain("signed-so-far");
  });

  it("is closed to the signed-out without a link, and to a wrong link", async () => {
    user = null;
    expect((await call()).status).toBe(401);
    tokenOk = false;
    expect((await call("?t=bad")).status).toBe(404);
    expect(getCopy).not.toHaveBeenCalled();
  });

  it("says so when nothing has been signed", async () => {
    copy = null;
    expect((await call()).status).toBe(404);
  });
});
