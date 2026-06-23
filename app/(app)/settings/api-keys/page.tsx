import { redirect } from "next/navigation";

// /settings/api-keys is a deep-link alias for the API Keys section of the
// Settings page. The section anchor is #api (matching the section id in
// settings/page.tsx). Redirect rather than 404.
export default function SettingsApiKeysRedirect() {
  redirect("/settings#api");
}
