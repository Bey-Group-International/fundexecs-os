// lib/document-create.ts
//
// What the Documents › Create tab offers, as data.
//
// Everything here already existed and was unreachable. The template library was
// only openable from inside the builder — so you had to create a blank document
// before you could discover there was a template for it, which is backwards.
// KEY_MATERIALS and hasMaterial() were written to answer "is the core
// fundraising collateral present?" and then never called by anything.
//
// Create is where those belong: the four ways a document comes into being, in
// one place, with the firm's own state folded in so the page can say what is
// already there rather than offering the same twelve choices to everyone.
//
// Pure and dependency-free so the shape of the offer can be tested without a
// database or a DOM.
import { DATA_ROOM_SECTIONS, KEY_MATERIALS, hasMaterial } from "@/lib/data-room";
import { DOCUMENT_TEMPLATE_LIBRARY, type DocTemplate } from "@/lib/document-template-library";

/**
 * Sections Earn can draft from the Build foundation without a source file.
 *
 * Lives here rather than in either consumer because both the Library and Create
 * need it and two copies would drift — the Library's copy was the original.
 */
export const AI_DRAFTABLE_SECTIONS: ReadonlySet<string> = new Set([
  "overview",
  "thesis",
  "marketing",
  "team",
  "track_record",
]);

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));
const SECTION_ORDER = new Map(DATA_ROOM_SECTIONS.map((s, i) => [s.key, i]));

/** Label for a section key, falling back to the key itself for an unknown one. */
export function sectionLabelOf(key: string): string {
  return SECTION_LABEL.get(key) ?? key;
}

export interface CreateTemplate {
  id: string;
  label: string;
  description: string;
  section: string;
  sectionLabel: string;
  /** The scaffold itself, so the gallery can preview without a second fetch. */
  content: string;
}

export interface TemplateGroup {
  section: string;
  sectionLabel: string;
  templates: CreateTemplate[];
}

/**
 * Templates grouped by the section they belong to, in data-room order.
 *
 * The picker inside the builder listed them as one flat column split only into
 * "for this section" and "all templates", which stops being readable the moment
 * there is no current section to be relative to — which is exactly the case on
 * a Create tab.
 */
export function groupTemplates(templates: DocTemplate[] = DOCUMENT_TEMPLATE_LIBRARY): TemplateGroup[] {
  const by = new Map<string, CreateTemplate[]>();
  for (const t of templates) {
    const entry: CreateTemplate = {
      id: t.id,
      label: t.label,
      description: t.description,
      section: t.section,
      sectionLabel: sectionLabelOf(t.section),
      content: t.content,
    };
    const bucket = by.get(t.section);
    if (bucket) bucket.push(entry);
    else by.set(t.section, [entry]);
  }
  return [...by.entries()]
    .map(([section, group]) => ({
      section,
      sectionLabel: sectionLabelOf(section),
      templates: [...group].sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => (SECTION_ORDER.get(a.section) ?? 99) - (SECTION_ORDER.get(b.section) ?? 99));
}

// Which template starts a given key material, where one exists. Matched by
// name rather than by section: KEY_MATERIALS files Executive Summary under
// marketing while the template calls it overview, and both are defensible — the
// material is what the operator is looking for, the section is where it lands.
// A material with no template still offers a blank document, and AI drafting
// where its section supports it.
const MATERIAL_TEMPLATE: Record<string, string> = {
  "Executive Summary": "exec_summary",
  "Investor Deck": "pitch_deck_outline",
  "One-Pager": "tear_sheet",
};

export interface MaterialStatus {
  name: string;
  section: string;
  sectionLabel: string;
  /** True when a document in the library already matches this material. */
  present: boolean;
  /** Template to start from, when one exists. */
  templateId: string | null;
  /** Whether Earn can draft this material's section from the Build foundation. */
  aiDraftable: boolean;
}

/**
 * The core fundraising collateral, each marked present or missing.
 *
 * Matching is by name alias (hasMaterial), not by section, because an operator
 * who filed their deck under Firm Overview still has a deck. A false "missing"
 * on a document they can see in the Library would make the whole checklist
 * untrustworthy.
 */
export function keyMaterialStatus(docNames: string[]): MaterialStatus[] {
  return KEY_MATERIALS.map((m) => ({
    name: m.name,
    section: m.section,
    sectionLabel: sectionLabelOf(m.section),
    present: hasMaterial(m, docNames),
    templateId: MATERIAL_TEMPLATE[m.name] ?? null,
    aiDraftable: AI_DRAFTABLE_SECTIONS.has(m.section),
  }));
}

/** How many of the core materials are still missing. */
export function missingMaterialCount(statuses: MaterialStatus[]): number {
  return statuses.filter((s) => !s.present).length;
}
