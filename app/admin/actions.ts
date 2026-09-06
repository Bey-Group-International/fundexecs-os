"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { decideAccessRequest } from "@/lib/admin/access-requests";

// Approve / decline an access request from the admin console.
//
// The /admin layout already gates the page, but a server action is its own
// entry point — anything reachable by POST re-checks the gate here rather than
// trusting that the caller came from a rendered admin page.
async function decide(
  id: string,
  decision: "approved" | "declined",
): Promise<{ error?: string }> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) return { error: "Not authorized." };
  if (!id) return { error: "Missing request id." };

  const result = await decideAccessRequest({
    id,
    decision,
    reviewerId: gate.ctx.userId,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin");
  return {};
}

export async function approveAccessRequest(id: string): Promise<{ error?: string }> {
  return decide(id, "approved");
}

export async function declineAccessRequest(id: string): Promise<{ error?: string }> {
  return decide(id, "declined");
}
