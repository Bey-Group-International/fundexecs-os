import { redirect } from "next/navigation";

// /settings/digest is a deep-link alias for the Digest section of the Settings
// page. Redirect rather than 404.
export default function SettingsDigestRedirect() {
  redirect("/settings#digest");
}
