import HubLayout from "@/app/(app)/[hub]/layout";

// The Firm Identity page (/build/profile) and its legacy redirects live in their
// own route folder, so the shared hub layout (module tabs and the readiness card)
// did not wrap them: the first tab of the Build hub was the one page with no tabs
// to the others. Render the same layout here.
export default function BuildLayout({ children }: { children: React.ReactNode }) {
  return <HubLayout params={Promise.resolve({ hub: "build" })}>{children}</HubLayout>;
}
