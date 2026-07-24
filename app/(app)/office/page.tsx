export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded via an iframe. The container is sized
// to the map's aspect ratio (1204×735) and capped to the viewport, so the whole
// office is visible with no letterboxing. It opens in a clean "view" of the
// office; right-click anywhere surfaces a Build Mode entry with the full editor.
export default function OfficePage() {
  return (
    <div
      className="mx-auto w-full overflow-hidden rounded-xl border border-[#1c2e4a] bg-[#070c16]"
      style={{
        aspectRatio: "1204 / 735",
        maxWidth: "min(100%, calc((100dvh - 7rem) * 1204 / 735))",
      }}
    >
      <iframe
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}
