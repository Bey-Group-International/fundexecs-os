import { redirect } from "next/navigation";

// The Thesis surface is now a section of the unified Firm Identity page. This
// legacy route redirects into that section so existing links keep working.
export default function BuildThesisRedirect() {
  redirect("/build/profile#thesis");
}
