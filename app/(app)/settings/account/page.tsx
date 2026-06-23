import { redirect } from "next/navigation";

// /settings/account is a deep-link alias for the Account section of the
// Settings page. Redirect rather than 404.
export default function SettingsAccountRedirect() {
  redirect("/settings#account");
}
