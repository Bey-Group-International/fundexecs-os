export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded via an iframe. The wrapper is given an
// EXPLICIT viewport-based height — not a percentage `h-full`, which fails to
// resolve here (the parent supplies only a min-height, and min-height is not a
// definite basis for a percentage child, so the iframe would collapse to its
// 150px default). With a real height the iframe fills the content area and the
// map (which cover-fits internally) fills the frame. Opens in a clean view
// (Top / 1st-person nav); right-click surfaces Build Mode and Character Studio
// (the latter navigates the app to /office/builder — see map.html openMenu()).
export default function OfficePage() {
  return (
    <div className="h-[calc(100dvh-8rem)] min-h-[420px] w-full overflow-hidden rounded-xl border border-[#1c2e4a] bg-[#070c16]">
      <iframe
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}
