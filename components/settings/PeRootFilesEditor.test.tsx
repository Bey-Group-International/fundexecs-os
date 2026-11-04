/**
 * The root-file editor: validation runs live in the browser with the same pure
 * module the server uses; a read-only member sees no write controls; saving and
 * approving go through the server actions and surface what they return.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeRootFilesEditor } from "./PeRootFilesEditor";
import { FIXTURE } from "@/lib/pe/test-fixture";

const save = jest.fn();
const approve = jest.fn();
const clear = jest.fn();
jest.mock("@/app/(app)/settings/pe-actions", () => ({
  savePeRootFile: (...a: unknown[]) => save(...a),
  approvePeMandate: (...a: unknown[]) => approve(...a),
  clearPeRootFile: (...a: unknown[]) => clear(...a),
}));

const files = [
  { key: "mandate", title: "Investment mandate", blurb: "b", typed: true, starter: "{}" },
  { key: "evidence", title: "Evidence", blurb: "b", typed: false, starter: "{}" },
];
const stored = [{ key: "mandate", content: JSON.stringify({ ...FIXTURE, status: "draft" }, null, 2), version: 2, updatedAt: null }];

beforeEach(() => {
  save.mockReset();
  approve.mockReset();
  clear.mockReset();
});

describe("PeRootFilesEditor", () => {
  it("a read-only member sees the settings but no write controls", () => {
    render(<PeRootFilesEditor files={files} stored={stored} canManage={false} />);
    expect(screen.getByText(/Only organization owners and admins can change them/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve mandate/ })).toBeNull();
  });

  it("disables Save and shows the error for invalid JSON, and unblocks on valid input", async () => {
    render(<PeRootFilesEditor files={files} stored={[]} canManage />);
    const box = screen.getByLabelText("Evidence (JSON)");
    fireEvent.change(box, { target: { value: "{nope" } });
    expect(screen.getByText(/Not valid JSON/)).toBeTruthy();
    const saveBtns = screen.getAllByRole("button", { name: "Save" });
    expect(saveBtns[1]).toHaveProperty("disabled", true);
    fireEvent.change(box, { target: { value: '{"firmName":"X"}' } });
    expect(screen.getByText(/No skill reads this file yet/)).toBeTruthy();
    expect(saveBtns[1]).toHaveProperty("disabled", false);
  });

  it("saves the typed text and shows the server's warnings; approve surfaces blockers", async () => {
    save.mockResolvedValue({ ok: true, warnings: ["1 malformed criterion(s) were dropped"] });
    approve.mockResolvedValue({ ok: false, error: "The mandate cannot be approved yet.", issues: ["Hard limit has no threshold"] });
    render(<PeRootFilesEditor files={files} stored={stored} canManage />);

    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith("mandate", stored[0].content));
    expect(await screen.findByText(/Saved\./)).toBeTruthy();
    expect(screen.getByText(/malformed criterion/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Approve mandate/ }));
    expect(await screen.findByText(/cannot be approved yet/)).toBeTruthy();
    expect(screen.getByText(/Hard limit has no threshold/)).toBeTruthy();
  });

  it("labels a stored mandate as draft, and an unset file as the standing default", () => {
    render(<PeRootFilesEditor files={files} stored={stored} canManage />);
    expect(screen.getByText(/saved · v2 · draft/)).toBeTruthy();
    expect(screen.getByText(/not set · standing default/)).toBeTruthy();
  });
});
