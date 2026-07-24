export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded full-bleed. It fills the content area
// horizontally; the map fits to width so the office spans edge-to-edge. It
// opens in a clean "view" of the office (Top / 1st-person nav at the top);
// right-click anywhere surfaces a Build Mode entry with the full editor.
export default function OfficePage() {
  return (
    <div className="h-full min-h-[520px] w-full overflow-hidden rounded-xl border border-[#1c2e4a] bg-[#070c16]">
      <iframe
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}
