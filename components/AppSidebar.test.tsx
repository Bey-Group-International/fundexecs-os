/**
 * The rail groups its links and opens the hub that owns the current page. The
 * grouping is a presentation change, so the test that matters most is that no
 * destination the old flat lists exposed has gone missing.
 */
let mockPath = "/dashboard";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));
jest.mock("@/components/Logo", () => ({ Logo: () => <span>logo</span> }));
jest.mock("@/components/nav/mobile-nav", () => ({
  useMobileNav: () => ({ open: false, setOpen: () => {}, toggle: () => {} }),
}));
jest.mock("@/hooks/useFocusTrap", () => ({ useFocusTrap: () => {} }));

import { render, screen, fireEvent } from "@testing-library/react";
import { AppSidebar } from "./AppSidebar";

const noop = () => {};
const props = {
  name: "Ada",
  planName: "Pro",
  hubs: [
    { key: "build", label: "Build", modules: [{ href: "/build/profile", label: "Firm Identity" }] },
    { key: "run", label: "Run", modules: [{ href: "/run/diligence", label: "Diligence" }] },
  ],
  sessions: [],
  groups: [],
  signOutAction: noop,
  createGroupAction: noop,
  moveSessionAction: noop,
  deleteSessionAction: noop,
  renameSessionAction: noop,
  shareSessionAction: noop,
  archiveSessionAction: noop,
  pinSessionAction: noop,
  unreadSessionAction: noop,
};

const hrefs = () =>
  screen.getAllByRole("link").map((a) => a.getAttribute("href"));

it("still links every top-level destination", () => {
  mockPath = "/dashboard";
  render(<AppSidebar {...props} />);
  for (const h of [
    "/dashboard", "/office", "/workspace", "/automations", "/inbox",
    "/network", "/marketplace", "/meetings", "/pulse",
  ]) {
    expect(hrefs()).toContain(h);
  }
});

it("keeps every account-menu destination after grouping", () => {
  mockPath = "/dashboard";
  render(<AppSidebar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
  for (const h of [
    "/settings", "/settings#integrations", "/settings#help", "/settings#about",
    "/wallet", "/wallet/treasury", "/invite", "/gift", "/earn",
  ]) {
    expect(hrefs()).toContain(h);
  }
  expect(screen.getByRole("button", { name: "Walkthrough" })).toBeInTheDocument();
});

it("marks the current page and opens only the hub that owns it", () => {
  mockPath = "/run/diligence";
  render(<AppSidebar {...props} />);
  expect(screen.getByRole("link", { name: "Diligence" })).toHaveAttribute("href", "/run/diligence");
  expect(screen.queryByRole("link", { name: "Firm Identity" })).not.toBeInTheDocument();
});

it("lets a manual toggle override the automatic open", () => {
  mockPath = "/run/diligence";
  render(<AppSidebar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /^Build/ }));
  expect(screen.getByRole("link", { name: "Firm Identity" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Diligence" })).not.toBeInTheDocument();
});

it("sets aria-current only on the top-level link for the current page", () => {
  mockPath = "/inbox";
  render(<AppSidebar {...props} />);
  expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
});

it("keeps module labels aligned when only some modules have a status dot", () => {
  mockPath = "/build/profile";
  render(
    <AppSidebar
      {...props}
      hubs={[
        {
          key: "build",
          label: "Build",
          modules: [
            { href: "/build/profile", label: "Firm Identity", status: "complete" as const },
            { href: "/build/documents", label: "Documents" },
          ],
        },
      ]}
    />,
  );
  const withDot = screen.getByRole("link", { name: "Firm Identity" });
  const without = screen.getByRole("link", { name: "Documents" });
  // Both rows lead with a one-dot-wide element before the label.
  expect(withDot.firstElementChild?.className).toContain("w-1.5");
  expect(without.firstElementChild?.className).toContain("w-1.5");
});
