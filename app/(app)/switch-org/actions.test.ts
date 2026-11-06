import { switchOrganization } from "@/app/(app)/switch-org/actions";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

jest.mock("@/lib/auth", () => ({ getSessionContext: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: jest.fn() }));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

const set = jest.fn();

function memberOf(found: boolean) {
  const q = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: found ? { organization_id: "org-b" } : null }),
  };
  (createServerClient as jest.Mock).mockResolvedValue({ from: jest.fn().mockReturnValue(q) });
  return q;
}

function form(orgId: string) {
  const f = new FormData();
  f.set("orgId", orgId);
  return f;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getSessionContext as jest.Mock).mockResolvedValue({ userId: "u1", orgId: "org-a" });
  (cookies as jest.Mock).mockResolvedValue({ set });
});

it("saves the choice and lands on the dashboard when the person is a member", async () => {
  const q = memberOf(true);
  await switchOrganization(form("org-b"));
  expect(q.eq).toHaveBeenCalledWith("principal_id", "u1");
  expect(q.eq).toHaveBeenCalledWith("organization_id", "org-b");
  expect(set).toHaveBeenCalledWith("fx_active_org", "org-b", expect.objectContaining({ httpOnly: true, path: "/" }));
  expect(redirect).toHaveBeenCalledWith("/dashboard");
});

it("does not save an organization the person is not a member of", async () => {
  memberOf(false);
  await switchOrganization(form("not-mine"));
  expect(set).not.toHaveBeenCalled();
  expect(redirect).toHaveBeenCalledWith("/dashboard");
});

it("does nothing without an organization id", async () => {
  await switchOrganization(form(""));
  expect(createServerClient).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});

it("sends a signed-out person to log in", async () => {
  (getSessionContext as jest.Mock).mockResolvedValue(null);
  (redirect as unknown as jest.Mock).mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  await expect(switchOrganization(form("org-b"))).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledWith("/login");
  expect(set).not.toHaveBeenCalled();
});
