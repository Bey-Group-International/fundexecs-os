export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded full-bleed. It opens in a clean
// "view" of the office; right-click anywhere surfaces a Build Mode entry that
// reveals the full editing toolset.
export default function OfficePage() {
  return (
    <div className="h-full min-h-[520px] overflow-hidden rounded-xl border border-[#1c2e4a] bg-[#070c16]">
      <iframe
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}
