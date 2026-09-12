/**
 * The member-photo control. The two ways in — click and drag-and-drop — are
 * the whole feature, so both are exercised here, along with the initials
 * fallback that shows when there is no photo.
 *
 * `encodeAvatar` (canvas) and the upload actions (server) are mocked: jsdom has
 * no canvas encoder and no server, and neither is what this file is testing.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/dom";
import { AvatarUpload } from "./AvatarUpload";

const encodeAvatar = jest.fn();
const uploadAvatar = jest.fn();
const removeAvatar = jest.fn();

jest.mock("./avatar-encode", () => ({
  encodeAvatar: (file: File) => encodeAvatar(file),
}));
jest.mock("./avatar-actions", () => ({
  uploadAvatar: (fd: FormData) => uploadAvatar(fd),
  removeAvatar: (fd: FormData) => removeAvatar(fd),
}));

const UPLOADED =
  "https://proj.supabase.co/storage/v1/object/public/member-avatars/org-1/p-1.jpg";

function imageFile(name = "me.png", type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

beforeAll(() => {
  // jsdom implements neither; the control creates and revokes preview URLs.
  URL.createObjectURL = jest.fn(() => "blob:preview");
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  encodeAvatar.mockResolvedValue({ file: imageFile("avatar.jpg", "image/jpeg"), previewUrl: "blob:preview" });
  uploadAvatar.mockResolvedValue({ url: UPLOADED });
  removeAvatar.mockResolvedValue({});
});

describe("with no photo", () => {
  it("is a circle showing the member's initial", () => {
    render(<AvatarUpload name="Ada Lovelace" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder initial when there is no name", () => {
    render(<AvatarUpload name={null} />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("offers no Remove control", () => {
    render(<AvatarUpload name="Ada" size="md" />);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("is just the circle when inline in a member list", () => {
    render(<AvatarUpload name="Ada" currentUrl={UPLOADED} size="sm" />);
    expect(screen.queryByText(/click or drag/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change profile photo" })).toBeInTheDocument();
  });
});

describe("click to add", () => {
  it("uploads the picked file and shows the photo", async () => {
    render(<AvatarUpload name="Ada" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, imageFile());

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1));
    expect(encodeAvatar).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:preview");
  });

  it("sends the target member when acting on someone else's photo", async () => {
    render(<AvatarUpload name="Bob" principalId="p-2" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, imageFile());

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1));
    expect((uploadAvatar.mock.calls[0][0] as FormData).get("principal_id")).toBe("p-2");
  });
});

describe("drag and drop", () => {
  function drop(target: Element, files: File[]) {
    fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
  }

  it("uploads an image dropped on the circle", async () => {
    render(<AvatarUpload name="Ada" />);
    const circle = screen.getByRole("button", { name: "Add a profile photo" });

    drop(circle, [imageFile()]);

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });

  it("shows a drop affordance while an image is over the circle", () => {
    render(<AvatarUpload name="Ada" />);
    const circle = screen.getByRole("button", { name: "Add a profile photo" });

    fireEvent.dragOver(circle, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Drop")).toBeInTheDocument();

    fireEvent.dragLeave(circle, { relatedTarget: document.body });
    expect(screen.queryByText("Drop")).not.toBeInTheDocument();
  });

  it("rejects a dropped file that is not an image", async () => {
    render(<AvatarUpload name="Ada" />);
    const circle = screen.getByRole("button", { name: "Add a profile photo" });

    drop(circle, [new File(["x"], "notes.pdf", { type: "application/pdf" })]);

    expect(await screen.findByText(/isn't an image/i)).toBeInTheDocument();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("explains the case where a drag carries no file at all", async () => {
    render(<AvatarUpload name="Ada" />);
    const circle = screen.getByRole("button", { name: "Add a profile photo" });

    drop(circle, []);

    expect(await screen.findByText(/image file saved on your device/i)).toBeInTheDocument();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });
});

describe("with a photo", () => {
  it("renders the stored photo and can remove it", async () => {
    render(<AvatarUpload name="Ada" currentUrl={UPLOADED} size="md" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", UPLOADED);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(removeAvatar).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("ignores a stored value that is not one of our uploads", () => {
    render(<AvatarUpload name="Ada" currentUrl="https://lh3.googleusercontent.com/a/X" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("deferred mode (onboarding, before the org exists)", () => {
  it("hands the encoded file to the parent instead of uploading", async () => {
    const onFileSelected = jest.fn();
    render(<AvatarUpload name="Ada" onFileSelected={onFileSelected} />);
    const circle = screen.getByRole("button", { name: "Add a profile photo" });

    fireEvent.drop(circle, { dataTransfer: { files: [imageFile()], types: ["Files"] } });

    await waitFor(() => expect(onFileSelected).toHaveBeenCalledTimes(1));
    expect(onFileSelected.mock.calls[0][0]).toBeInstanceOf(File);
    expect(uploadAvatar).not.toHaveBeenCalled();
  });
});

describe("when the upload fails", () => {
  it("surfaces the error and keeps the initials", async () => {
    uploadAvatar.mockResolvedValue({ error: "Could not upload that photo." });
    render(<AvatarUpload name="Ada" />);

    fireEvent.drop(screen.getByRole("button", { name: "Add a profile photo" }), {
      dataTransfer: { files: [imageFile()], types: ["Files"] },
    });

    expect(await screen.findByText("Could not upload that photo.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("surfaces an image the browser cannot decode", async () => {
    encodeAvatar.mockResolvedValue({ error: "Could not read that file." });
    render(<AvatarUpload name="Ada" />);

    fireEvent.drop(screen.getByRole("button", { name: "Add a profile photo" }), {
      dataTransfer: { files: [imageFile()], types: ["Files"] },
    });

    expect(await screen.findByText("Could not read that file.")).toBeInTheDocument();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });
});
