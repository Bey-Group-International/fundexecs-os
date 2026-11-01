/**
 * What a watermarked link hands out, by file type. The rule: bytes that can be
 * marked are marked before they leave; bytes that cannot be marked are not
 * handed out at all, except video to the viewer's own player.
 */
jest.mock("server-only", () => ({}), { virtual: true });

const SIGNED = "https://storage.example/signed-unmarked-copy";
const signDocumentUrl = jest.fn(async () => SIGNED);
let access: unknown;
let stored: Buffer;

jest.mock("@/lib/data-room-access.server", () => ({
  resolveSharedDocument: async () => access,
  watermarkLabel: () => "lp@example.com · 2026-11-01 21:00 UTC",
}));
jest.mock("@/lib/document-storage.server", () => ({ signDocumentUrl: (...a: unknown[]) => (signDocumentUrl as jest.Mock)(...a) }));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 1, resetAt: 0, retryAfter: 0 }),
  clientIp: () => "1.2.3.4",
  rateLimitHeaders: () => ({}),
}));

import sharp from "sharp";
import { GET } from "./route";

const ID = "00000000-0000-4000-8000-0000000000a1";
const params = { params: Promise.resolve({ token: "tok", id: ID }) };
const req = (query = "") => new Request(`http://localhost/dataroom/tok/d/${ID}${query}`);

function grant(storageKey: string, bytes: Buffer, share: Record<string, unknown> = {}) {
  stored = bytes;
  access = {
    ok: true,
    supabase: {
      from: () => ({ insert: () => ({ then: (r: (v: unknown) => unknown) => r(undefined) }) }),
      storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(stored)]), error: null }) }) },
    },
    share: { id: "s1", organization_id: "o1", watermark: true, allow_download: true, ...share },
    doc: { id: ID, name: "Deck", storage_key: storageKey },
    roomId: "r1",
    viewerEmail: "lp@example.com",
  };
}

const white = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } });

async function nonWhite(bytes: Buffer): Promise<number> {
  const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i] !== 255) n++;
  return n;
}

beforeEach(() => signDocumentUrl.mockClear());

describe("a watermarked link, for files it can mark", () => {
  it.each([["png"], ["jpeg"]] as const)("stamps a %s and never mints a signed URL", async (fmt) => {
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    grant(`o1/d/pic.${ext}`, await white(300, 200)[fmt]().toBuffer());
    for (const q of ["", "?embed=1", "?download=1"]) {
      const res = await GET(req(q), params);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(`image/${fmt}`);
      expect(await nonWhite(Buffer.from(await res.arrayBuffer()))).toBeGreaterThan(100);
    }
    expect(signDocumentUrl).not.toHaveBeenCalled();
  });

  it("serves a GIF as a stamped PNG named .png", async () => {
    grant("o1/d/anim.gif", await white(300, 200).gif().toBuffer());
    const res = await GET(req("?download=1"), params);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("Deck.png");
  });

  it("stamps a text file", async () => {
    grant("o1/d/terms.txt", Buffer.from("Carry 20%"));
    const res = await GET(req("?download=1"), params);
    const body = await res.text();
    expect(body).toContain("=== lp@example.com · 2026-11-01 21:00 UTC ===");
    expect(body).toContain("Carry 20%");
    expect(signDocumentUrl).not.toHaveBeenCalled();
  });

  it("fails closed on bytes that are not the image they claim to be", async () => {
    grant("o1/d/pic.png", Buffer.from("not an image"));
    const res = await GET(req("?embed=1"), params);
    expect(res.status).toBe(422);
    expect(signDocumentUrl).not.toHaveBeenCalled();
  });
});

describe("a watermarked link, for files it cannot mark", () => {
  it.each(["docx", "xlsx", "pptx", "csv", "rtf", "svg"])("refuses a %s download and embed, never signing a URL", async (ext) => {
    grant(`o1/d/file.${ext}`, Buffer.from("x"));
    expect((await GET(req("?download=1"), params)).status).toBe(403);
    expect((await GET(req("?embed=1"), params)).status).toBe(403);
    expect(signDocumentUrl).not.toHaveBeenCalled();
  });

  it("sends a plain open back to the viewer, where the label is drawn over it", async () => {
    grant("o1/d/file.docx", Buffer.from("x"));
    const res = await GET(req(), params);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain(`/dataroom/tok?doc=${ID}`);
    expect(signDocumentUrl).not.toHaveBeenCalled();
  });

  it("lets video through to the viewer's own player only", async () => {
    grant("o1/d/walkthrough.mp4", Buffer.from("x"));
    const embed = await GET(req("?embed=1"), params);
    expect(embed.headers.get("location")).toBe(SIGNED);
    expect((await GET(req("?download=1"), params)).status).toBe(403);
    expect((await GET(req(), params)).headers.get("location")).toContain("?doc=");
  });
});

describe("a link that is not watermarked", () => {
  it("is unchanged: a signed URL for any file", async () => {
    grant("o1/d/file.docx", Buffer.from("x"), { watermark: false });
    const res = await GET(req("?download=1"), params);
    expect(res.headers.get("location")).toBe(SIGNED);
  });
});
