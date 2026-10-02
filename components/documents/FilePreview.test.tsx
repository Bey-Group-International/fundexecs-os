import { act, fireEvent, render, screen } from "@testing-library/react";
import { FilePreview } from "./FilePreview";

describe("FilePreview PDF", () => {
  function renderPdf() {
    return render(<FilePreview kind="pdf" src="/api/documents/d1/preview" previewUrl="" name="PPM.pdf" />);
  }

  it("shields the PDF so the wheel scrolls the page until the reader clicks in", () => {
    const { container } = renderPdf();
    expect(container.querySelector("iframe")?.getAttribute("title")).toBe("PPM.pdf");
    expect(screen.getByRole("button", { name: "Scroll inside PPM.pdf" })).toBeTruthy();
  });

  it("hands the wheel to the PDF on click and takes it back when the cursor leaves", () => {
    const { container } = renderPdf();
    fireEvent.click(screen.getByRole("button", { name: "Scroll inside PPM.pdf" }));
    expect(screen.queryByRole("button", { name: "Scroll inside PPM.pdf" })).toBeNull();
    fireEvent.mouseLeave(container.firstElementChild as Element);
    expect(screen.getByRole("button", { name: "Scroll inside PPM.pdf" })).toBeTruthy();
  });

  it("takes the wheel back on a tap elsewhere", () => {
    renderPdf();
    fireEvent.click(screen.getByRole("button", { name: "Scroll inside PPM.pdf" }));
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(screen.getByRole("button", { name: "Scroll inside PPM.pdf" })).toBeTruthy();
  });

  it("keeps the inactive PDF out of the tab order and focuses it on activation", () => {
    const { container } = renderPdf();
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.tabIndex).toBe(-1);
    fireEvent.click(screen.getByRole("button", { name: "Scroll inside PPM.pdf" }));
    expect(frame.tabIndex).toBe(0);
    expect(document.activeElement).toBe(frame);
  });
});
