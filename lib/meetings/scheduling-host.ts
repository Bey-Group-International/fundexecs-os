// lib/meetings/scheduling-host.ts
// Resolving the host's real contact details for a booking notification.
//
// A scheduling page carries a display name the host chose for public view; the
// address their confirmation actually goes to lives on their principal record.
// Kept apart from scheduling-service so nothing in the public booking response
// path can accidentally serialize it.
import type { SchedulingClient } from "@/lib/meetings/scheduling-service";
import type { SchedulingPage } from "@/lib/supabase/database.types";

export interface HostContact {
  email: string | null;
  fullName: string | null;
}

/** The host's notification address, or nulls when their principal row is gone. */
export async function hostContactFor(client: SchedulingClient, page: SchedulingPage): Promise<HostContact> {
  const { data } = await client.from("principals").select("email, full_name").eq("id", page.user_id).maybeSingle();
  const row = data as { email: string | null; full_name: string | null } | null;
  return { email: row?.email ?? null, fullName: row?.full_name ?? null };
}
