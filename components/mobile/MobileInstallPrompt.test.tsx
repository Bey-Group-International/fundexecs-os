import { fireEvent, render, screen } from "@testing-library/react";
import { MobileInstallPrompt } from "./MobileInstallPrompt";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function setBrowser(userAgent: string, opts: { standalone?: boolean; maxTouchPoints?: number } = {}) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: opts.maxTouchPoints ?? 5 });
  Object.defineProperty(window.navigator, "standalone", { configurable: true, value: opts.standalone ?? false });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(display-mode: standalone)" ? !!opts.standalone : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("MobileInstallPrompt on Safari for iPhone", () => {
  it("shows the Add to Home Screen card without waiting for beforeinstallprompt", () => {
    setBrowser(IPHONE_SAFARI);
    render(<MobileInstallPrompt />);
    expect(screen.getByText("Add to your Home Screen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show me how" })).toBeInTheDocument();
  });

  it("opens the step-by-step guide that starts at the Share button", () => {
    setBrowser(IPHONE_SAFARI);
    render(<MobileInstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Tap the Share button")).toBeInTheDocument();
    expect(screen.getByText("Tap “Add to Home Screen”")).toBeInTheDocument();
    expect(screen.getByText("Tap “Add”")).toBeInTheDocument();
  });

  it("dismisses from the guide and remembers the dismissal", () => {
    setBrowser(IPHONE_SAFARI);
    const { unmount } = render(<MobileInstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Add to your Home Screen")).not.toBeInTheDocument();
    expect(localStorage.getItem("fx:install-prompt-dismissed-at")).toBeTruthy();

    unmount();
    render(<MobileInstallPrompt />);
    expect(screen.queryByText("Add to your Home Screen")).not.toBeInTheDocument();
  });

  it("stays hidden once the app runs from the Home Screen", () => {
    setBrowser(IPHONE_SAFARI, { standalone: true });
    render(<MobileInstallPrompt />);
    expect(screen.queryByText("Add to your Home Screen")).not.toBeInTheDocument();
  });
});

describe("MobileInstallPrompt in an iPhone in-app browser", () => {
  it("tells the operator to open the page in Safari first", () => {
    setBrowser(IPHONE_INSTAGRAM);
    render(<MobileInstallPrompt />);
    expect(screen.getByText("Open in Safari to install")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    expect(screen.getByText("Open this page in Safari")).toBeInTheDocument();
  });
});

describe("MobileInstallPrompt on Chromium", () => {
  it("renders nothing until the browser announces installability, then uses the native prompt", async () => {
    setBrowser(ANDROID_CHROME);
    render(<MobileInstallPrompt />);
    expect(screen.queryByText(/Install FundExecs OS|Add to your Home Screen/)).not.toBeInTheDocument();

    const prompt = jest.fn().mockResolvedValue(undefined);
    const evt = new Event("beforeinstallprompt") as Event & { prompt: typeof prompt; userChoice: Promise<unknown> };
    evt.prompt = prompt;
    evt.userChoice = Promise.resolve({ outcome: "accepted" });
    fireEvent(window, evt);

    expect(await screen.findByText("Install FundExecs OS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Home Screen" }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
