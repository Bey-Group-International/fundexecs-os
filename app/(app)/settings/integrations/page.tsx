import { redirect } from "next/navigation";

// /settings/integrations is a deep-link alias for the Integrations section of
// the Settings page. Redirect rather than 404.
export default function SettingsIntegrationsRedirect() {
  redirect("/settings#integrations");
}
