// lib/signing/pdf-layout.ts
//
// How big a page sits on screen before it has been drawn, so the document does not jump as
// pages load and a long one only draws the pages near the screen. Pure.

/** The widest a page is drawn, in CSS pixels. */
export const MAX_PAGE_WIDTH = 900;
/** A US Letter page is 11 / 8.5 as tall as it is wide; used until a real page says otherwise. */
export const DEFAULT_PAGE_RATIO = 11 / 8.5;
/** How far outside the screen a page is still drawn, so scrolling does not show blank pages. */
export const DRAW_MARGIN_PX = 1200;

/** Width a page is drawn at for a container this wide. */
export const pageWidth = (containerWidth: number) => Math.min(containerWidth, MAX_PAGE_WIDTH);

/** The box a page occupies before it is drawn. `ratio` is height over width. */
export function pageBox(containerWidth: number, ratio: number = DEFAULT_PAGE_RATIO): { width: number; height: number } {
  const width = pageWidth(containerWidth);
  const r = Number.isFinite(ratio) && ratio > 0.2 && ratio < 5 ? ratio : DEFAULT_PAGE_RATIO;
  return { width, height: Math.round(width * r) };
}
