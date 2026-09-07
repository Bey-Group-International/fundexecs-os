"use server";

import { redirect } from "next/navigation";
import { submitAccessRequest } from "@/lib/access-requests";
import { fieldsFor, isApplicantType } from "@/lib/access-request-fields";

// Public entry point for the invite-only queue. There is no self-serve sign-up:
// this records the request and alerts the internal team, and grants nothing.
//
// The form posts whatever fields the chosen applicant type asks for, so the
// action reads them back off the same schema rather than naming them here —
// one place to add a question.
export async function requestAccess(formData: FormData) {
  const applicantType = String(formData.get("applicant_type") ?? "");
  const email = String(formData.get("email") ?? "");

  const values: Record<string, string> = {};
  if (isApplicantType(applicantType)) {
    for (const field of fieldsFor(applicantType)) {
      values[field.name] = String(formData.get(field.name) ?? "");
    }
  }

  const result = await submitAccessRequest({
    email,
    fullName: String(formData.get("full_name") ?? ""),
    applicantType,
    values,
  });

  if (!result.ok) {
    // Keep them on the form with their email and type so a retry costs one
    // field, not the whole form.
    const params = new URLSearchParams({
      error: result.error,
      email,
      ...(isApplicantType(applicantType) ? { type: applicantType } : {}),
    });
    redirect(`/request-access?${params.toString()}`);
  }

  redirect("/request-access?submitted=1");
}
