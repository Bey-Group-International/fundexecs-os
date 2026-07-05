import { redirect } from "next/navigation";

// LP reporting is no longer an independent page — Execute › Reporting is the
// single reporting surface (live portfolio snapshot, tax allocation, and the
// reports you draft). This route is kept only to redirect any existing deep
// links there so nothing 404s.
export default function ReportsPage() {
  redirect("/execute/reporting");
}
