import { redirect } from "next/navigation";

// /settings/mcp is a deep-link alias for the MCP servers subsection of the
// Settings Integrations section. Redirect rather than 404.
export default function SettingsMcpRedirect() {
  redirect("/settings#mcp");
}
