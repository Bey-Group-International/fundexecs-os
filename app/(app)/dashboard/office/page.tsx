import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The Virtual Office feature has been removed. This route is kept only as a
// graceful redirect so stale clients — browsers still running an older cached
// bundle that renders the old "Office" nav tab — land on the dashboard instead
// of a 404 while their cache and service worker refresh.
export default function OfficeRedirect() {
  redirect("/dashboard");
}
