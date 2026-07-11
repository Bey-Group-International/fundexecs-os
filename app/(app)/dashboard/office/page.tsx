import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The AI Executive Command Floor now lives at the canonical /virtual-office
// front door. This legacy route redirects there so existing links, bookmarks,
// and the dashboard "Office" entry keep working.
export default function OfficeRedirect() {
  redirect("/virtual-office");
}
