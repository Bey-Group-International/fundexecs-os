// /build/profile (Firm Identity) lives outside app/(app)/[hub], so the hub layout
// with the module tabs and readiness card has to be applied to it explicitly.
import BuildLayout from "@/app/(app)/build/layout";
import HubLayout from "@/app/(app)/[hub]/layout";

jest.mock("@/app/(app)/[hub]/layout", () => ({ __esModule: true, default: jest.fn() }));

it("wraps the Build routes in the shared hub layout for the build hub", async () => {
  const child = <p>page</p>;
  const el = BuildLayout({ children: child });
  expect(el.type).toBe(HubLayout);
  await expect(el.props.params).resolves.toEqual({ hub: "build" });
  expect(el.props.children).toBe(child);
});
