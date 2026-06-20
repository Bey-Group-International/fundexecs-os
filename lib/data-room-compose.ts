// lib/data-room-compose.ts
// Deterministic "compose from your data" for the document builder: turns the
// firm's existing Build foundation into a first-draft markdown document for a
// given data-room section. Pure — unit-tested and reused as the offline draft.
export interface ComposeFoundation {
  orgName: string;
  tagline: string | null;
  description: string | null;
  entityType: string | null;
  jurisdiction: string | null;
  website: string | null;
  thesisTitle: string | null;
  thesisSummary: string | null;
  assetClasses: string[];
  geographies: string[];
  targetIrr: number | null;
  targetMoic: number | null;
  dealCount: number;
  realizedCount: number;
  grossIrr: number | null;
  pooledMoic: number | null;
  totalInvested: string | null; // pre-formatted (compact USD)
  team: { name: string; title: string | null }[];
  entities: string[];
}

function bullets(lines: (string | null | undefined)[]): string {
  const items = lines.filter((l): l is string => !!l && l.trim().length > 0);
  return items.length ? items.map((l) => `- ${l}`).join("\n") : "- [TODO]";
}

function overview(f: ComposeFoundation): string {
  return [
    `# ${f.orgName}`,
    f.tagline ? `_${f.tagline}_` : null,
    "",
    f.description || "[TODO: firm overview]",
    "",
    "## At a glance",
    bullets([
      f.entityType ? `Entity: ${f.entityType}` : null,
      f.jurisdiction ? `Jurisdiction: ${f.jurisdiction}` : null,
      f.website ? `Website: ${f.website}` : null,
      f.thesisTitle ? `Strategy: ${f.thesisTitle}` : null,
    ]),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function thesis(f: ComposeFoundation): string {
  return [
    `# Investment Strategy${f.thesisTitle ? ` — ${f.thesisTitle}` : ""}`,
    "",
    f.thesisSummary || "[TODO: thesis summary]",
    "",
    "## Mandate",
    bullets([
      f.assetClasses.length ? `Asset classes: ${f.assetClasses.join(", ")}` : null,
      f.geographies.length ? `Geographies: ${f.geographies.join(", ")}` : null,
      f.targetIrr != null ? `Target gross IRR: ${f.targetIrr}%` : null,
      f.targetMoic != null ? `Target MOIC: ${f.targetMoic}x` : null,
    ]),
  ].join("\n");
}

function trackRecord(f: ComposeFoundation): string {
  return [
    "# Track Record",
    "",
    f.dealCount > 0
      ? `Across ${f.dealCount} deals (${f.realizedCount} realized):`
      : "[TODO: add deals to your Track Record]",
    "",
    bullets([
      f.grossIrr != null ? `Weighted gross IRR: ${f.grossIrr}%` : null,
      f.pooledMoic != null ? `Pooled MOIC: ${f.pooledMoic}x` : null,
      f.totalInvested ? `Total invested: ${f.totalInvested}` : null,
    ]),
  ].join("\n");
}

function team(f: ComposeFoundation): string {
  const rows = f.team.length
    ? f.team.map((m) => `- **${m.name}**${m.title ? ` — ${m.title}` : ""}`).join("\n")
    : "- [TODO: add team members]";
  return ["# Team", "", rows].join("\n");
}

function execSummary(f: ComposeFoundation): string {
  return [
    `# Executive Summary — ${f.orgName}`,
    f.tagline ? `_${f.tagline}_` : null,
    "",
    f.description || "[TODO: one-paragraph firm overview]",
    "",
    "## Strategy",
    f.thesisSummary || (f.thesisTitle ? f.thesisTitle : "[TODO: strategy]"),
    "",
    "## Track record",
    f.dealCount > 0
      ? bullets([
          f.grossIrr != null ? `Weighted gross IRR: ${f.grossIrr}%` : null,
          f.pooledMoic != null ? `Pooled MOIC: ${f.pooledMoic}x` : null,
          `${f.dealCount} deals · ${f.realizedCount} realized`,
        ])
      : "[TODO: track record]",
    "",
    "## Team",
    f.team.length ? f.team.map((m) => `- ${m.name}${m.title ? ` — ${m.title}` : ""}`).join("\n") : "- [TODO]",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Compose a first-draft document. Picks a template from the document name
 * (executive summary / one-pager) or its section, falling back to a firm
 * overview. Always returns non-empty markdown.
 */
export function composeDraft(docName: string, section: string | null, f: ComposeFoundation): string {
  const name = docName.toLowerCase();
  if (name.includes("executive summary") || name.includes("one-pager") || name.includes("one pager")) {
    return execSummary(f);
  }
  switch (section) {
    case "thesis":
      return thesis(f);
    case "track_record":
      return trackRecord(f);
    case "team":
      return team(f);
    case "overview":
    case "marketing":
      return overview(f);
    default:
      return execSummary(f);
  }
}
