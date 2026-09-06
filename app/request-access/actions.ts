"use server";

import { redirect } from "next/navigation";
import { submitAccessRequest } from "@/lib/access-requests";

// Public entry point for the invite-only queue. There is no self-serve sign-up:
// this records the request and alerts the internal team, and grants nothing.
export async function requestAccess(formData: FormData) {
  const result = await submitAccessRequest({
    email: String(formData.get("email") ?? ""),
    fullName: String(formData.get("full_name") ?? ""),
    firm: String(formData.get("firm") ?? ""),
    role: String(formData.get("role") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!result.ok) {
    // Keep them on the form with their email so a retry costs one field, not five.
    const params = new URLSearchParams({
      error: result.error,
      email: String(formData.get("email") ?? ""),
    });
    redirect(`/request-access?${params.toString()}`);
  }

  redirect("/request-access?submitted=1");
}
