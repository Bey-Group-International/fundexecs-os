"use client";

/**
 * Pixel Map Studio — a 32×32 orthogonal tile editor for FundExecs workspaces.
 * Build from templates or blank, place furniture/tech/signage/zones across
 * layers, edit branding, preview PBR lighting, and export a WorkAdventure-
 * compatible Tiled bundle with a live compatibility report.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { tiledReport } from "@/lib/pixel-studio/adapters/tiled";
import { MAP_ASSETS } from "@/lib/pixel-studio/map/map-assets";
import { TEMPLATES } from "@/lib/pixel-studio/map/map-project";
import type { MapProject } from "@/lib/pixel-studio/types";
import { MapCanvas } from "./MapCanvas";
import { downloadMap, downloadText } from "./exports-client";
import { useMapStudio, type MapTool } from "./useMapStudio";

const GOLD = "#c9a84c";
const CATEGORIES = ["floor", "wall", "furniture", "technology", "signage", "screen", "decor", "exterior", "zone"] as const;

export function PixelMapStudio({ initial }: { initial?: MapProject }) {
  const { state, actions } = useMapStudio(initial);
  const { project } = state;
  const [assetCat, setAssetCat] = useState<(typeof CATEGORIES)[number]>("furniture");
  const [assetSearch, setAssetSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const report = useMemo(() => tiledReport(project, "preview"), [project]);
  const assets = useMemo(
    () => MAP_ASSETS.filter((a) => a.category === assetCat && (!assetSearch || a.label.toLowerCase().includes(assetSearch.toLowerCase()))),
    [assetCat, assetSearch],
  );

  const onCell = (x: number, y: number) => {
    if (state.tool === "erase") actions.eraseCell(x, y);
    else if (state.tool === "place") actions.place(x, y);
  };

  return (
    <div className="flex flex-col gap-2 text-neutral-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
        <input value={project.name} onChange={(e) => actions.setMeta({ name: e.target.value })} className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm" aria-label="Map name" />
        <label className="text-xs">Template
          <select onChange={(e) => { if (e.target.value) { if (confirm("Replace current map with this template?")) actions.newFromTemplate(e.target.value); e.target.value = ""; } }} className="ml-1 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs" defaultValue="">
            <option value="">Load…</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <TB onClick={() => actions.undo()} disabled={state.past.length === 0}>↶ Undo</TB>
        <TB onClick={() => actions.redo()} disabled={state.future.length === 0}>↷ Redo</TB>
        <TB onClick={() => actions.toggleGrid()}>{state.showGrid ? "▦ Grid on" : "▢ Grid off"}</TB>
        <div className="mx-1 h-5 w-px bg-neutral-800" />
        <TB onClick={() => { const name = project.name || "Office"; actions.save(name); flash(`Saved “${name}”`); }}>💾 Save</TB>
        <TB onClick={() => fileRef.current?.click()}>⇧ Import Tiled</TB>
        <TB onClick={() => { downloadText(actions.exportTiledJson(), `${project.mapId}.tmj`); flash("Exported Tiled JSON"); }}>⇩ .tmj</TB>
        <TB onClick={async () => { await downloadMap(project); flash("Exported map bundle"); }}>⇩ Map bundle</TB>
        <input ref={fileRef} type="file" accept="application/json,.tmj,.json" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const res = actions.importTiledJson(await f.text());
          flash(res.ok ? "Imported Tiled map" : `Import failed: ${res.error}`);
          e.target.value = "";
        }} />
        <Link href="/virtual-office/pixel-studio" className="ml-auto rounded border border-neutral-700 px-2 py-1 text-sm hover:border-[color:var(--g)]" style={{ ["--g" as string]: GOLD }}>← Character Studio</Link>
      </div>

      {notice && <div role="status" className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: GOLD, color: GOLD }}>{notice}</div>}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[240px_1fr_280px]">
        {/* LEFT: asset palette + layers */}
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2 text-xs">
          <div className="flex gap-1" role="group" aria-label="Tool">
            {(["place", "erase", "select"] as MapTool[]).map((t) => (
              <button key={t} onClick={() => actions.setTool(t)} aria-pressed={state.tool === t}
                className={`flex-1 rounded px-2 py-1 ${state.tool === t ? "text-neutral-950" : "border border-neutral-700"}`}
                style={state.tool === t ? { background: GOLD } : undefined}>{t}</button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setAssetCat(c)} aria-pressed={assetCat === c}
                className={`rounded px-1.5 py-0.5 text-[10px] ${assetCat === c ? "text-neutral-950" : "border border-neutral-800"}`}
                style={assetCat === c ? { background: GOLD } : undefined}>{c}</button>
            ))}
          </div>
          <input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder="Search assets…" className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1" aria-label="Search map assets" />

          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto" role="listbox" aria-label="Map assets">
            {assets.map((a) => (
              <button key={a.id} onClick={() => actions.select(a.id)} aria-selected={state.selectedAsset === a.id} role="option"
                className={`rounded border p-1 text-left text-[10px] ${state.selectedAsset === a.id ? "border-2" : "border-neutral-800 hover:border-neutral-600"}`}
                style={state.selectedAsset === a.id ? { borderColor: GOLD } : undefined}>
                <div className="truncate">{a.label}</div>
                <div className="text-neutral-500">{a.size.w}×{a.size.h}{a.collides ? " · solid" : ""}{a.interaction ? ` · ${a.interaction}` : ""}</div>
              </button>
            ))}
          </div>

          <div className="mt-1 border-t border-neutral-800 pt-1">
            <div className="mb-1 font-semibold text-neutral-300">Layers</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {project.layers.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-1">
                  <span className="truncate">{l.label}</span>
                  <span className="flex gap-1">
                    <button onClick={() => actions.toggleLayerVisible(l.id)} aria-label={`${l.visible ? "Hide" : "Show"} ${l.label}`} title="Visibility">{l.visible ? "👁" : "🚫"}</button>
                    <button onClick={() => actions.toggleLayerLocked(l.id)} aria-label={`${l.locked ? "Unlock" : "Lock"} ${l.label}`} title="Lock">{l.locked ? "🔒" : "🔓"}</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CENTER: canvas */}
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">{project.width}×{project.height} tiles</span>
              <label className="flex items-center gap-1">Zoom
                <input type="range" min={6} max={40} value={state.zoom} onChange={(e) => actions.setZoom(Number(e.target.value))} aria-label="Map zoom" />
              </label>
              <label className="flex items-center gap-1">Size
                <input type="number" min={6} max={64} value={project.width} onChange={(e) => actions.resizeMap(Number(e.target.value), project.height)} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1" aria-label="Map width" />×
                <input type="number" min={6} max={64} value={project.height} onChange={(e) => actions.resizeMap(project.width, Number(e.target.value))} className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1" aria-label="Map height" />
              </label>
            </div>
            <div className="flex items-center gap-1 rounded border border-neutral-700 p-0.5">
              {(["pixel", "pbr"] as const).map((m) => (
                <button key={m} onClick={() => actions.setView(m)} aria-pressed={state.viewMode === m}
                  className={`rounded px-2 py-0.5 ${state.viewMode === m ? "text-neutral-950" : ""}`}
                  style={state.viewMode === m ? { background: GOLD } : undefined}>{m === "pixel" ? "Pixel" : "PBR"}</button>
              ))}
            </div>
          </div>
          <MapCanvas project={project} zoom={state.zoom} showGrid={state.showGrid} viewMode={state.viewMode} onCell={onCell} />
        </div>

        {/* RIGHT: branding + report */}
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
          <div>
            <div className="mb-1 font-semibold text-neutral-300">Branding</div>
            <label className="mb-1 flex items-center justify-between">Company
              <input value={project.branding.companyName} onChange={(e) => actions.setBranding({ companyName: e.target.value })} className="w-32 rounded border border-neutral-700 bg-neutral-900 px-1" aria-label="Company name" />
            </label>
            <label className="mb-1 flex items-center justify-between">Primary
              <input type="color" value={project.branding.primaryColor} onChange={(e) => actions.setBranding({ primaryColor: e.target.value })} aria-label="Primary color" />
            </label>
            <label className="flex items-center justify-between">Secondary
              <input type="color" value={project.branding.secondaryColor} onChange={(e) => actions.setBranding({ secondaryColor: e.target.value })} aria-label="Secondary color" />
            </label>
          </div>

          <div>
            <div className="mb-1 font-semibold text-neutral-300">WorkAdventure Compatibility</div>
            <ul className="space-y-0.5">
              {report.entries.map((e, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span aria-hidden>{e.status === "ok" ? "✓" : e.status === "missing" ? "✗" : "▲"}</span>
                  <span className={e.status === "missing" ? "text-red-400" : e.status === "ok" ? "text-emerald-300" : "text-amber-300"}>
                    {e.requirement}
                    <span className="block text-neutral-500">{e.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 font-semibold text-neutral-300">Saved Maps ({state.saved.length})</div>
            {state.saved.length === 0 ? <div className="text-neutral-500">None saved.</div> : (
              <ul className="space-y-0.5">
                {state.saved.map((m) => (
                  <li key={m.id} className="flex items-center justify-between">
                    <span className="truncate">{m.name}</span>
                    <span className="flex gap-1">
                      <button onClick={() => actions.load(m)} style={{ color: GOLD }}>Load</button>
                      <button onClick={() => { if (confirm(`Delete “${m.name}”?`)) actions.remove(m.id); }} className="text-red-400">Del</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TB({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:opacity-40">
      {children}
    </button>
  );
}
