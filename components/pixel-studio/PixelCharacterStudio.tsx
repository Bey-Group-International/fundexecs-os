"use client";

/**
 * Pixel Character Studio — the raster executive editor that replaces the legacy
 * vector avatar. Three panels: category/asset navigation (left), animated
 * preview + controls (center), and inspector (right), with a saved/export
 * drawer below. All rendering flows through the shared compositor; all
 * compatibility comes from the data-driven AssetRegistry.
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AssetRegistry } from "@/lib/pixel-studio/asset-registry";
import { getManifest } from "@/lib/pixel-studio/manifest";
import { seedFromString } from "@/lib/pixel-studio/rng";
import { encodeShare } from "@/lib/pixel-studio/character";
import { DIRECTIONS_UI, STATES_UI } from "@/lib/pixel-studio/character";
import type { AssetCategory, CharacterConfig, FitGroup } from "@/lib/pixel-studio/types";
import { PixelCanvas } from "./PixelCanvas";
import { downloadExtended, downloadText, downloadWorkAdventure } from "./exports-client";
import { useCharacterStudio, type ViewMode } from "./useCharacterStudio";

const GOLD = "#c9a84c";

type SectionId =
  | "skin"
  | "face"
  | "expression"
  | "hair"
  | "hairColor"
  | "facialHair"
  | "headCovering"
  | "outfit"
  | "accessory";

const SECTIONS: { id: SectionId; label: string; lockKey: string }[] = [
  { id: "skin", label: "Skin Tone", lockKey: "skin" },
  { id: "face", label: "Face", lockKey: "face" },
  { id: "expression", label: "Expression", lockKey: "expression" },
  { id: "hair", label: "Hair", lockKey: "hair" },
  { id: "hairColor", label: "Hair Color", lockKey: "hairColor" },
  { id: "facialHair", label: "Facial Hair", lockKey: "facialHair" },
  { id: "headCovering", label: "Head Covering", lockKey: "headCovering" },
  { id: "outfit", label: "Outfit System", lockKey: "outfit" },
  { id: "accessory", label: "Accessories", lockKey: "accessory" },
];

export function PixelCharacterStudio({ initial }: { initial?: CharacterConfig }) {
  const { state, actions, registry, manifest, compatibilityIssues } = useCharacterStudio(initial);
  const { config } = state;
  const [section, setSection] = useState<SectionId>("skin");
  const [search, setSearch] = useState("");
  const [seedText, setSeedText] = useState("fundexecs");
  const [frameInfo, setFrameInfo] = useState({ frame: 0, total: 1 });
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const layerStack = useMemo(() => registry.resolveLayers(config), [registry, config]);

  // Options for the active section.
  const options = useMemo(
    () => buildOptions(section, config, registry, manifest, search, actions.patch),
    [section, config, registry, manifest, search, actions.patch],
  );

  const seed = seedFromString(seedText);

  return (
    <div className="flex flex-col gap-2 text-neutral-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
        <label className="sr-only" htmlFor="exec-name">Executive name</label>
        <input
          id="exec-name"
          value={config.displayName}
          onChange={(e) => actions.patch({ displayName: e.target.value })}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm focus:border-[color:var(--g)] focus:outline-none"
          style={{ ["--g" as string]: GOLD }}
          aria-label="Executive name"
        />
        <ToolbarButton onClick={() => actions.undo()} disabled={state.past.length === 0} label="Undo">↶ Undo</ToolbarButton>
        <ToolbarButton onClick={() => actions.redo()} disabled={state.future.length === 0} label="Redo">↷ Redo</ToolbarButton>
        <ToolbarButton onClick={() => { const name = config.displayName || "Executive"; actions.save(name); flash(`Saved “${name}”`); }} label="Save preset">💾 Save</ToolbarButton>
        <ToolbarButton onClick={() => actions.duplicate()} label="Duplicate">⧉ Duplicate</ToolbarButton>
        <ToolbarButton onClick={() => { if (confirm("Reset to default? Unsaved changes to this executive will be lost.")) actions.reset(); }} label="Reset to default">⟲ Reset</ToolbarButton>
        <div className="mx-1 h-5 w-px bg-neutral-800" />
        <input
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          aria-label="Random seed"
          placeholder="seed"
        />
        <ToolbarButton onClick={() => actions.randomizeAll(seed)} label="Randomize all (respects locks)">🎲 Randomize</ToolbarButton>
        <div className="mx-1 h-5 w-px bg-neutral-800" />
        <ToolbarButton onClick={() => fileRef.current?.click()} label="Import configuration JSON">⇧ Import</ToolbarButton>
        <ToolbarButton onClick={() => { downloadText(actions.exportJson(), `${config.characterId}.json`); actions.recordExport("config-json", config.displayName); }} label="Export configuration JSON">⇩ Config</ToolbarButton>
        <ToolbarButton onClick={async () => { await downloadWorkAdventure(registry, config); actions.recordExport("workadventure", config.displayName); flash("Exported WorkAdventure bundle"); }} label="Export WorkAdventure bundle">⇩ WorkAdventure</ToolbarButton>
        <ToolbarButton onClick={async () => { await downloadExtended(registry, config); actions.recordExport("extended", config.displayName); flash("Exported FundExecs extended bundle"); }} label="Export FundExecs extended bundle">⇩ Extended</ToolbarButton>
        <div className="mx-1 h-5 w-px bg-neutral-800" />
        <ToolbarButton onClick={() => { navigator.clipboard?.writeText(config.characterId); flash("Copied character ID"); }} label="Copy character ID">🆔 Copy ID</ToolbarButton>
        <ToolbarButton onClick={() => { const url = `${location.origin}${location.pathname}?c=${encodeShare(config)}`; navigator.clipboard?.writeText(url); flash("Copied shareable link"); }} label="Copy shareable link">🔗 Share</ToolbarButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            const res = actions.importJson(text);
            flash(res.ok ? "Imported configuration" : `Import failed: ${res.error}`);
            e.target.value = "";
          }}
        />
        <Link href="/virtual-office/pixel-studio/map" className="ml-auto rounded border border-neutral-700 px-2 py-1 text-sm hover:border-[color:var(--g)]" style={{ ["--g" as string]: GOLD }}>
          Open Map Studio →
        </Link>
      </div>

      {notice && (
        <div role="status" className="rounded border px-3 py-1.5 text-sm" style={{ borderColor: GOLD, color: GOLD }}>
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[260px_1fr_300px]">
        {/* LEFT: categories + options */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
          <div className="mb-2 flex flex-wrap gap-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 ${section === s.id ? "text-neutral-950" : "text-neutral-300 hover:bg-neutral-800"}`}
                style={section === s.id ? { background: GOLD } : undefined}
                aria-pressed={section === s.id}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
              aria-label="Search assets"
            />
            <LockButton
              locked={state.locks.includes(section as never)}
              onClick={() => actions.toggleLock(section as never)}
            />
            <button
              onClick={() => actions.randomizeCategory(section as never, seed)}
              className="rounded border border-neutral-700 px-2 py-1 text-xs hover:border-[color:var(--g)]"
              style={{ ["--g" as string]: GOLD }}
              aria-label={`Randomize ${section}`}
              title="Randomize this category"
            >
              🎲
            </button>
          </div>

          <div className="grid max-h-[52vh] grid-cols-3 gap-1.5 overflow-y-auto pr-1" role="listbox" aria-label={`${section} options`}>
            {options.map((opt) => (
              <button
                key={opt.key}
                onClick={opt.onSelect}
                aria-selected={opt.selected}
                role="option"
                className={`flex flex-col items-center gap-1 rounded border p-1 text-[10px] focus:outline-none focus:ring-1 ${opt.selected ? "border-2" : "border-neutral-800 hover:border-neutral-600"}`}
                style={opt.selected ? { borderColor: GOLD } : undefined}
                title={opt.label}
              >
                {opt.swatch ? (
                  <span className="h-8 w-8 rounded" style={{ background: opt.swatch }} aria-hidden />
                ) : opt.previewConfig ? (
                  <PixelCanvas config={opt.previewConfig} direction="down" state="idle" scale={2} viewMode="pixel" frame={0} ariaLabel={opt.label} />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-neutral-800 text-neutral-500">∅</span>
                )}
                <span className="line-clamp-1 w-full text-center">{opt.label}</span>
              </button>
            ))}
          </div>

          {section === "outfit" && <ColorwayPicker config={config} registry={registry} onPick={(cw) => actions.patch({ outfitColorway: cw })} />}
        </div>

        {/* CENTER: preview + controls */}
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{config.displayName}</div>
            <div className="flex items-center gap-1 rounded border border-neutral-700 p-0.5 text-xs">
              {(["pixel", "pbr"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => actions.setViewMode(m)}
                  className={`rounded px-2 py-0.5 ${state.viewMode === m ? "text-neutral-950" : "text-neutral-300"}`}
                  style={state.viewMode === m ? { background: GOLD } : undefined}
                  aria-pressed={state.viewMode === m}
                >
                  {m === "pixel" ? "Pixel Runtime" : "PBR Showcase"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-center gap-4 rounded-md bg-[radial-gradient(120%_80%_at_50%_30%,#1c2130_0%,#0c0e14_75%)] p-4">
            <div className="flex flex-col items-center gap-1">
              <PixelCanvas
                config={config}
                direction={state.direction}
                state={state.animState}
                scale={state.zoom}
                viewMode={state.viewMode}
                animate
                playing={state.playing}
                speed={state.speed}
                lightIntensity={state.lightIntensity}
                lightAngle={state.lightAngle}
                onFrame={(frame, total) => setFrameInfo({ frame, total })}
                className="rounded"
              />
              <div className="text-[10px] text-neutral-500">
                frame {frameInfo.frame + 1}/{frameInfo.total} · {state.zoom}× · {state.viewMode === "pbr" ? "PBR" : "native"}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-col items-center">
                <PixelCanvas config={config} direction={state.direction} state={state.animState} scale={1} viewMode="pixel" frame={frameInfo.frame} ariaLabel="Native 1× preview" />
                <span className="text-[10px] text-neutral-500">1× native</span>
              </div>
              <div className="flex flex-col items-center">
                <PixelCanvas config={config} direction={state.direction} state={state.animState} scale={8} viewMode="pixel" frame={frameInfo.frame} className="h-16 w-16" ariaLabel="8× review preview" />
                <span className="text-[10px] text-neutral-500">8× review</span>
              </div>
            </div>
          </div>

          {/* Direction + state */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label="Direction">
              {DIRECTIONS_UI.map((d) => (
                <button key={d.id} onClick={() => actions.setDirection(d.id)} aria-pressed={state.direction === d.id}
                  className={`rounded px-2 py-1 text-xs ${state.direction === d.id ? "text-neutral-950" : "border border-neutral-700 text-neutral-300"}`}
                  style={state.direction === d.id ? { background: GOLD } : undefined}>{d.label}</button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Animation state">
              {STATES_UI.map((s) => (
                <button key={s.id} onClick={() => actions.setAnimState(s.id)} aria-pressed={state.animState === s.id}
                  className={`rounded px-2 py-1 text-xs ${state.animState === s.id ? "text-neutral-950" : "border border-neutral-700 text-neutral-300"}`}
                  style={state.animState === s.id ? { background: GOLD } : undefined}>{s.label}</button>
              ))}
            </div>
          </div>

          {/* Playback */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button onClick={() => actions.setPlaying(!state.playing)} className="rounded border border-neutral-700 px-2 py-1" aria-label={state.playing ? "Pause" : "Play"}>{state.playing ? "⏸ Pause" : "▶ Play"}</button>
            <button onClick={() => actions.setPlaying(false)} className="rounded border border-neutral-700 px-2 py-1" aria-label="Stop">⏹</button>
            <label className="flex items-center gap-1">Speed
              <select value={state.speed} onChange={(e) => actions.setSpeed(Number(e.target.value))} className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5" aria-label="Animation speed">
                {[0.25, 0.5, 1, 1.5, 2, 3].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">Zoom
              <input type="range" min={2} max={16} step={1} value={state.zoom} onChange={(e) => actions.setZoom(Number(e.target.value))} aria-label="Preview zoom" />
            </label>
            {state.viewMode === "pbr" && (
              <>
                <label className="flex items-center gap-1">Light ∠
                  <input type="range" min={0} max={360} value={state.lightAngle} onChange={(e) => actions.setLight(undefined, Number(e.target.value))} aria-label="Light angle" />
                </label>
                <label className="flex items-center gap-1">Key
                  <input type="range" min={0.2} max={2} step={0.1} value={state.lightIntensity} onChange={(e) => actions.setLight(Number(e.target.value))} aria-label="Key light intensity" />
                </label>
              </>
            )}
          </div>
        </div>

        {/* RIGHT: inspector */}
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
          <div>
            <div className="mb-1 font-semibold text-neutral-300">Layer Stack ({layerStack.length})</div>
            <ol className="max-h-48 space-y-0.5 overflow-y-auto">
              {layerStack.map((l) => (
                <li key={l.asset.id} className="flex items-center justify-between rounded bg-neutral-900/60 px-2 py-0.5">
                  <span className="truncate">{l.slot}</span>
                  <span className="ml-2 shrink-0 text-neutral-500">z{l.zIndex} · {l.materialId}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="mb-1 font-semibold text-neutral-300">Compatibility</div>
            {compatibilityIssues.length === 0 ? (
              <div className="rounded bg-emerald-950/40 px-2 py-1 text-emerald-300">✓ No conflicts</div>
            ) : (
              <ul className="space-y-0.5">
                {compatibilityIssues.map((i, idx) => (
                  <li key={idx} className="rounded bg-amber-950/40 px-2 py-1 text-amber-300">⚠ {i}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 font-semibold text-neutral-300">Fit</div>
            <div className="flex gap-1">
              {(["masculine-fit", "feminine-fit", "universal"] as FitGroup[]).map((f) => (
                <button key={f} onClick={() => actions.patch({ fitGroup: f })} aria-pressed={config.fitGroup === f}
                  className={`rounded px-2 py-1 ${config.fitGroup === f ? "text-neutral-950" : "border border-neutral-700"}`}
                  style={config.fitGroup === f ? { background: GOLD } : undefined}>{f.replace("-fit", "")}</button>
              ))}
            </div>
            <p className="mt-1 text-neutral-500">Fit tags filter suggestions only — any asset renders on any base.</p>
          </div>
        </div>
      </div>

      {/* BOTTOM: saved + export history */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
          <div className="mb-2 font-semibold text-neutral-300">Saved Executives ({state.saved.length})</div>
          {state.saved.length === 0 ? (
            <div className="text-neutral-500">No saved executives yet. Use Save to store one locally.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {state.saved.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded border border-neutral-800 p-1">
                  <PixelCanvas config={p.config} direction="down" state="idle" scale={2} viewMode="pixel" frame={0} ariaLabel={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.name}</div>
                    <div className="flex gap-1">
                      <button onClick={() => actions.load(p)} className="text-[color:var(--g)]" style={{ ["--g" as string]: GOLD }}>Load</button>
                      <button onClick={() => { if (confirm(`Delete “${p.name}”?`)) actions.deletePreset(p.id); }} className="text-red-400">Delete</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
          <div className="mb-2 font-semibold text-neutral-300">Export History ({state.exportHistory.length})</div>
          {state.exportHistory.length === 0 ? (
            <div className="text-neutral-500">Exports you generate appear here.</div>
          ) : (
            <ul className="space-y-0.5">
              {state.exportHistory.map((e) => (
                <li key={e.id} className="flex justify-between rounded bg-neutral-900/60 px-2 py-0.5">
                  <span>{e.kind}</span>
                  <span className="text-neutral-500">{e.name} · {new Date(e.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components --------------------------------------------------------

function ToolbarButton({ children, onClick, disabled, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LockButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={locked}
      aria-label={locked ? "Unlock category from randomization" : "Lock category from randomization"}
      title={locked ? "Locked — randomization skips this" : "Unlocked"}
      className={`rounded border px-2 py-1 text-xs ${locked ? "border-amber-500 text-amber-400" : "border-neutral-700 text-neutral-400"}`}
    >
      {locked ? "🔒" : "🔓"}
    </button>
  );
}

function ColorwayPicker({ config, registry, onPick }: { config: CharacterConfig; registry: AssetRegistry; onPick: (id: string) => void }) {
  const outfit = registry.outfit(config.outfitSystem);
  if (!outfit) return null;
  return (
    <div className="mt-2 border-t border-neutral-800 pt-2">
      <div className="mb-1 text-xs font-semibold text-neutral-300">Colorway</div>
      <div className="flex flex-wrap gap-1">
        {outfit.colorways.map((cw) => (
          <button key={cw.id} onClick={() => onPick(cw.id)} aria-pressed={config.outfitColorway === cw.id}
            className={`rounded px-2 py-1 text-xs ${config.outfitColorway === cw.id ? "text-neutral-950" : "border border-neutral-700 text-neutral-300"}`}
            style={config.outfitColorway === cw.id ? { background: GOLD } : undefined}>{cw.label}</button>
        ))}
      </div>
    </div>
  );
}

// --- Option builder --------------------------------------------------------

interface Option {
  key: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  swatch?: string;
  previewConfig?: CharacterConfig;
}

function buildOptions(
  section: SectionId,
  config: CharacterConfig,
  registry: AssetRegistry,
  manifest: ReturnType<typeof getManifest>,
  search: string,
  patch: (patch: Partial<CharacterConfig>) => void,
): Option[] {
  const q = search.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const preview = (p: Partial<CharacterConfig>): CharacterConfig => ({ ...config, ...p });

  switch (section) {
    case "skin":
      return Object.values(manifest.palettes).filter((p) => p.group === "skin" && matches(p.label)).map((p) => ({
        key: p.id, label: p.label, selected: config.skinPalette === p.id,
        swatch: p.colors.base, onSelect: () => patch({ skinPalette: p.id }),
      }));
    case "hairColor":
      return Object.values(manifest.palettes).filter((p) => p.group === "hair" && matches(p.label)).map((p) => ({
        key: p.id, label: p.label, selected: config.hairColor === p.id, swatch: p.colors.base,
        onSelect: () => patch({ hairColor: p.id, facialHairColor: p.id }),
      }));
    case "expression":
      return manifest.assets.filter((a) => a.category === "expression" && matches(a.label)).map((a) => {
        const kind = a.id.replace("expression-", "");
        return {
          key: a.id, label: a.label, selected: config.expression === kind,
          previewConfig: preview({ expression: kind }), onSelect: () => patch({ expression: kind }),
        };
      });
    case "face":
      return registry.compatibleWith("face", config.fitGroup).filter((a) => matches(a.label)).map((a) => ({
        key: a.id, label: a.label, selected: config.face === a.id, previewConfig: preview({ face: a.id }),
        onSelect: () => patch({ face: a.id }),
      }));
    case "hair":
      return [noneOption(config.hair === null, () => patch({ hair: null })),
        ...registry.compatibleWith("hair", config.fitGroup).filter((a) => matches(a.label)).map((a) => ({
          key: a.id, label: a.label, selected: config.hair === a.id, previewConfig: preview({ hair: a.id }),
          onSelect: () => patch({ hair: a.id }),
        }))];
    case "facialHair":
      return [noneOption(config.facialHair === null, () => patch({ facialHair: null })),
        ...registry.category("facialHair").filter((a) => matches(a.label)).map((a) => ({
          key: a.id, label: a.label, selected: config.facialHair === a.id, previewConfig: preview({ facialHair: a.id }),
          onSelect: () => patch({ facialHair: a.id }),
        }))];
    case "headCovering":
      return [noneOption(config.headCovering === null, () => patch({ headCovering: null })),
        ...registry.category("headCovering").filter((a) => matches(a.label)).map((a) => ({
          key: a.id, label: a.label, selected: config.headCovering === a.id, previewConfig: preview({ headCovering: a.id }),
          onSelect: () => patch({ headCovering: a.id }),
        }))];
    case "outfit":
      return manifest.outfitSystems.filter((o) => (o.fitGroups.includes("universal") || o.fitGroups.includes(config.fitGroup)) && matches(o.label)).map((o) => ({
        key: o.id, label: o.label, selected: config.outfitSystem === o.id,
        previewConfig: preview({ outfitSystem: o.id, outfitColorway: o.colorways[0].id }),
        onSelect: () => patch({ outfitSystem: o.id, outfitColorway: o.colorways[0].id }),
      }));
    case "accessory":
      return registry.category("accessory").filter((a) => matches(a.label)).map((a) => {
        const active = config.accessories.includes(a.id);
        const next = active
          ? config.accessories.filter((x) => x !== a.id)
          : [...config.accessories.filter((x) => !registry.require(a.id).excludes.includes(x)), a.id];
        return {
          key: a.id, label: a.label, selected: active,
          previewConfig: preview({ accessories: next }),
          onSelect: () => patch({ accessories: next }),
        };
      });
    default:
      return [];
  }
}

function noneOption(selected: boolean, onSelect: () => void): Option {
  return { key: "__none", label: "None", selected, onSelect };
}
