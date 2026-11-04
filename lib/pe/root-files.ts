// lib/pe/root-files.ts
// The per-organization "root files" the PE department skills read. Pure, no I/O.
//
// Every one of the eight root files has a typed, defensive parser; a malformed value is dropped
// (and reported by the editor), never coerced. A file that is missing or unusable resolves to
// null or the labelled standing default, so a skill never runs on something the firm did not write.

import { EMPTY_MANDATE, parseMandateTests, type MandateTests } from "./mandate-tests";
import { DEFAULT_EVIDENCE_POLICY, parseEvidencePolicy, type EvidencePolicy } from "./evidence";
import { parseFirmFile, type FirmFile } from "./gates";
import { parseMemoStructure, type MemoStructure } from "./memo-structure";
import { parseReportingStyle, type ReportingStyle } from "./reporting-style";
import { DEFAULT_FINANCING, parseFinancingPolicy, type FinancingPolicy } from "./financing-policy";
import { DEFAULT_KPI_POLICY, parseKpiPolicy, type KpiPolicy } from "./kpi-policy";
import { DEFAULT_RETURNS, parseReturnsHurdles, type ReturnsHurdles } from "./returns-hurdles";

export const ROOT_FILE_KEYS = ["firm", "mandate", "returns", "evidence", "ic_memo", "kpi", "financing", "reporting"] as const;
export type RootFileKey = (typeof ROOT_FILE_KEYS)[number];

export function isRootFileKey(k: string): k is RootFileKey {
  return (ROOT_FILE_KEYS as readonly string[]).includes(k);
}

export interface RootFileRow {
  file_key: string;
  content: unknown;
  version?: number | null;
}

export interface ResolvedRootFiles {
  /** The org's mandate, or an EMPTY draft when none is stored / parseable. */
  mandate: MandateTests;
  /** The org's return hurdles, or the labelled standing defaults. */
  returns: ReturnsHurdles;
  /** True when `returns` is the standing default, not the firm's own. */
  returnsAreDefault: boolean;
  /** The org's financing limits / covenant rules, or the labelled standing defaults. */
  financing: FinancingPolicy;
  financingIsDefault: boolean;
  /** The org's KPI materiality, or the labelled standing default. */
  kpi: KpiPolicy;
  kpiIsDefault: boolean;
  /** Which evidence grades may support a price: the org's own, or the labelled standing default. */
  evidence: EvidencePolicy;
  evidenceIsDefault: boolean;
  /** The org's IC memo structure, or null when none is stored (the ic-memo skill then uses its own twelve sections). */
  icMemo: MemoStructure | null;
  /** The org's reporting style for the LP update, or null (the skill then uses its standing format). */
  reporting: ReportingStyle | null;
  /** The org's firm file (gate owners, firm name), or null when none is stored. Skills then use their labelled generic roles. */
  firm: FirmFile | null;
  /** Keys with a stored, non-empty row. */
  found: RootFileKey[];
  missing: RootFileKey[];
  /** One short line for the run header, e.g. "Root files found: mandate. Not found: firm, returns, … — run on default settings." */
  statusLine: string;
}

/** Resolve stored rows into typed root files. Never throws; unparseable content counts as missing. */
export function resolveRootFiles(rows: RootFileRow[] | null | undefined): ResolvedRootFiles {
  const byKey = new Map<RootFileKey, RootFileRow>();
  for (const r of rows ?? []) {
    if (isRootFileKey(r.file_key)) byKey.set(r.file_key, r);
  }

  const mandateParsed = byKey.has("mandate") ? parseMandateTests(byKey.get("mandate")!.content) : null;
  const mandateUsable = !!mandateParsed && mandateParsed.hardLimits.length + mandateParsed.preferences.length + mandateParsed.killFacts.length > 0;

  const returnsParsed = byKey.has("returns") ? parseReturnsHurdles(byKey.get("returns")!.content) : null;

  const financingParsed = byKey.has("financing") ? parseFinancingPolicy(byKey.get("financing")!.content) : null;
  const kpiParsed = byKey.has("kpi") ? parseKpiPolicy(byKey.get("kpi")!.content) : null;

  const firmParsed = byKey.has("firm") ? parseFirmFile(byKey.get("firm")!.content).firm : null;

  const evidenceParsed = byKey.has("evidence") ? parseEvidencePolicy(byKey.get("evidence")!.content) : null;

  const icMemoParsed = byKey.has("ic_memo") ? parseMemoStructure(byKey.get("ic_memo")!.content).structure : null;

  const reportingParsed = byKey.has("reporting") ? parseReportingStyle(byKey.get("reporting")!.content).style : null;

  const found: RootFileKey[] = [];
  for (const k of ROOT_FILE_KEYS) {
    if (k === "mandate") {
      if (mandateUsable) found.push(k);
      continue;
    }
    if (k === "returns") {
      if (returnsParsed) found.push(k);
      continue;
    }
    if (k === "financing") {
      if (financingParsed) found.push(k);
      continue;
    }
    if (k === "evidence") {
      if (evidenceParsed) found.push(k);
      continue;
    }
    if (k === "ic_memo") {
      if (icMemoParsed) found.push(k);
      continue;
    }
    if (k === "reporting") {
      if (reportingParsed) found.push(k);
      continue;
    }
    if (k === "firm") {
      if (firmParsed) found.push(k);
      continue;
    }
    if (k === "kpi") {
      if (kpiParsed) found.push(k);
      continue;
    }
    const c = byKey.get(k)?.content;
    if (c && typeof c === "object" && Object.keys(c as object).length > 0) found.push(k);
  }
  const missing = ROOT_FILE_KEYS.filter((k) => !found.includes(k));

  const statusLine =
    `Root files found: ${found.length ? found.join(", ") : "none"}. ` +
    `Not found: ${missing.length ? missing.join(", ") : "none"}` +
    (missing.length ? " — run on default settings." : ".");

  return { mandate: mandateUsable ? mandateParsed! : EMPTY_MANDATE, returns: returnsParsed ?? DEFAULT_RETURNS, returnsAreDefault: !returnsParsed, financing: financingParsed ?? DEFAULT_FINANCING, financingIsDefault: !financingParsed, kpi: kpiParsed ?? DEFAULT_KPI_POLICY, kpiIsDefault: !kpiParsed, evidence: evidenceParsed ?? DEFAULT_EVIDENCE_POLICY, evidenceIsDefault: !evidenceParsed, icMemo: icMemoParsed, reporting: reportingParsed, firm: firmParsed, found, missing, statusLine };
}
