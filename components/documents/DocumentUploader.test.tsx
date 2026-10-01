/**
 * Large files are a paid feature. On the Free plan the drop zone must say so up
 * front, refuse an over-plan file before anything is sent, and offer the
 * upgrade instead of a retry.
 */
const createUploadTicket = jest.fn();
jest.mock("./upload-actions", () => ({
  createUploadTicket: (...a: unknown[]) => createUploadTicket(...a),
  finalizeUpload: jest.fn(),
  abandonUpload: jest.fn(),
}));
jest.mock("./ZipImport", () => ({ ZipImport: () => null }));
jest.mock("tus-js-client", () => ({ Upload: jest.fn() }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentUploader } from "./DocumentUploader";
import { uploadAllowance } from "@/lib/document-files";

const MB = 1024 * 1024;

function bigFile(name: string, bytes: number): File {
  const f = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

function drop(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => createUploadTicket.mockReset());

describe("DocumentUploader on the Free plan", () => {
  it("states the free limit and links to upgrade", () => {
    render(<DocumentUploader section="other" sectionLabel="Other" allowance={uploadAllowance(false)} />);
    expect(screen.getByText(/Free plan · files up to 10 MB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/wallet");
  });

  it("refuses an over-plan file before uploading and offers the upgrade", async () => {
    render(<DocumentUploader section="other" sectionLabel="Other" allowance={uploadAllowance(false)} />);
    drop(bigFile("PPM.pdf", 20 * MB));
    await waitFor(() => expect(screen.getByText(/need a paid plan/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Upgrade →" })).toHaveAttribute("href", "/wallet");
    expect(createUploadTicket).not.toHaveBeenCalled();
  });
});

describe("DocumentUploader on a paid plan", () => {
  it("shows no plan notice and sends the same file on", async () => {
    createUploadTicket.mockResolvedValue({ ok: false, error: "stop here" });
    render(<DocumentUploader section="other" sectionLabel="Other" allowance={uploadAllowance(true)} />);
    expect(screen.queryByText(/Free plan/)).not.toBeInTheDocument();
    drop(bigFile("PPM.pdf", 20 * MB));
    await waitFor(() => expect(createUploadTicket).toHaveBeenCalledTimes(1));
  });
});
