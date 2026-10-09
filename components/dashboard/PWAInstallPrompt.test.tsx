import { fireEvent, render, screen } from "@testing-library/react";
import { PWAInstallPrompt } from "./PWAInstallPrompt";

const MAC_SAFARI_17 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_SAFARI_16 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function setBrowser(userAgent: string, opts: { standalone?: boolean; maxTouchPoints?: number } = {}) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: opts.maxTouchPoints ?? 0 });
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

describe("PWAInstallPrompt on Safari for Mac", () => {
  it("offers Add to Dock and reveals the File menu steps", () => {
    setBrowser(MAC_SAFARI_17);
    render(<PWAInstallPrompt />);
    expect(screen.getByText(/Add the workspace to your Dock from Safari/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    expect(screen.getByText(/File › Add to Dock/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the install page" })).toHaveAttribute("href", "/install");
  });

  it("treats an iPad on the desktop site as Add to Home Screen", () => {
    setBrowser(MAC_SAFARI_17, { maxTouchPoints: 5 });
    render(<PWAInstallPrompt />);
    expect(screen.getByText(/Add the workspace to your Home Screen from Safari/)).toBeInTheDocument();
  });

  it("does not nag an out-of-date Safari", () => {
    setBrowser(MAC_SAFARI_16);
    render(<PWAInstallPrompt />);
    expect(screen.queryByText(/Install FundExecs/)).not.toBeInTheDocument();
  });

  it("stays hidden inside the installed app and after Hide", () => {
    setBrowser(MAC_SAFARI_17, { standalone: true });
    const { unmount } = render(<PWAInstallPrompt />);
    expect(screen.queryByText(/Install FundExecs/)).not.toBeInTheDocument();
    unmount();

    setBrowser(MAC_SAFARI_17);
    const second = render(<PWAInstallPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(/Install FundExecs/)).not.toBeInTheDocument();
    second.unmount();
    render(<PWAInstallPrompt />);
    expect(screen.queryByText(/Install FundExecs/)).not.toBeInTheDocument();
  });
});

describe("PWAInstallPrompt on Chromium", () => {
  it("renders nothing until beforeinstallprompt fires", async () => {
    setBrowser(MAC_CHROME);
    render(<PWAInstallPrompt />);
    expect(screen.queryByText(/Install FundExecs/)).not.toBeInTheDocument();
    const evt = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
    evt.prompt = jest.fn().mockResolvedValue(undefined);
    evt.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    fireEvent(window, evt);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});
