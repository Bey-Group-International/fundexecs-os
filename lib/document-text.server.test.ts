jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/server", () => ({ hasSupabaseServiceEnv: () => false, createServiceClient: jest.fn() }));
import { extractFromBytes } from "./document-text.server";
import { DOCX, XLSX, makeZip } from "./ooxml-test-helpers";

describe("extractFromBytes", () => {
  it("dispatches Office files by extension and returns a preview", async () => {
    const docx = await extractFromBytes("o/d/x.docx", new Uint8Array(makeZip(DOCX)));
    expect(docx.status).toBe("ok");
    expect(docx.preview?.kind).toBe("docx");
    const xlsx = await extractFromBytes("o/d/x.xlsx", new Uint8Array(makeZip(XLSX)));
    expect(xlsx.text).toContain("Atlas Holdings");
  });

  it("reads plain text as-is", async () => {
    const t = await extractFromBytes("o/d/x.md", new TextEncoder().encode("# Memo\nHello"));
    expect(t).toEqual({ status: "ok", text: "# Memo\nHello", preview: null });
  });

  it("reports an empty file as empty, not ok", async () => {
    expect((await extractFromBytes("o/d/x.txt", new Uint8Array())).status).toBe("empty");
  });

  it("does not try to read formats it cannot", async () => {
    expect((await extractFromBytes("o/d/x.mp4", new Uint8Array([1, 2]))).status).toBe("unsupported");
  });
});
