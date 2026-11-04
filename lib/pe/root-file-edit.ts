// lib/pe/root-file-edit.ts
// Validation + normalisation for editing a PE root file. Pure. The rules:
//   * what is stored is the PARSED, normalised value — never the raw text — so a
//     skill can only ever read well-typed content;
//   * anything the parser drops is REPORTED, not silently discarded;
//   * an edit can never approve a mandate: status is forced to "draft" and the
//     approver is cleared, so sign-off is only ever the explicit approve action;
//   * the untyped files (firm, evidence, ic_memo, reporting) are stored as plain
//     objects within a size cap, and say plainly that no skill reads them yet.

import { auditMandate, parseMandateTests, type MandateIssue, type MandateTests } from "./mandate-tests";
import { parseReturnsHurdles } from "./returns-hurdles";
import { parseFinancingPolicy } from "./financing-policy";
import { parseKpiPolicy } from "./kpi-policy";
import { parseEvidencePolicyDetailed } from "./evidence";
import { MAX_MEMO_SECTIONS, MAX_TITLE_CHARS, parseMemoStructure } from "./memo-structure";
import { GATE_KEYS, MAX_OWNER_CHARS, parseFirmFile } from "./gates";
import { isRootFileKey, type RootFileKey } from "./root-files";

export const MAX_ROOT_FILE_BYTES = 50_000;

/** Files a skill reads today (typed). The rest are stored for later phases. */
export const TYPED_ROOT_FILES: RootFileKey[] = ["mandate", "returns", "financing", "kpi", "firm", "evidence", "ic_memo"];

export interface RootFileValidation {
  ok: boolean;
  /** The value to store. Present only when ok. */
  normalized?: Record<string, unknown>;
  errors: string[];
  /** Things dropped or changed on the way in. */
  warnings: string[];
  /** Mandate only: the static audit of the normalised mandate. */
  mandateIssues?: MandateIssue[];
  /** True when a skill currently reads this file. */
  readBySkills: boolean;
}

function countCriteria(m: MandateTests): number {
  return m.hardLimits.length + m.preferences.length + m.killFacts.length;
}

function rawCount(v: unknown, key: string): number {
  const o = v as Record<string, unknown>;
  return Array.isArray(o?.[key]) ? (o[key] as unknown[]).length : 0;
}

export function validateRootFileText(key: string, text: string): RootFileValidation {
  const fail = (msg: string): RootFileValidation => ({ ok: false, errors: [msg], warnings: [], readBySkills: false });
  if (!isRootFileKey(key)) return fail(`Unknown root file "${key}".`);
  if (new TextEncoder().encode(text).length > MAX_ROOT_FILE_BYTES) return fail(`Too large (limit ${MAX_ROOT_FILE_BYTES} bytes).`);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("A root file must be a JSON object.");

  const warnings: string[] = [];
  const readBySkills = TYPED_ROOT_FILES.includes(key);

  if (key === "mandate") {
    const parsed = parseMandateTests(raw);
    if (!parsed) return fail("Could not read a mandate from this object.");
    const dropped =
      rawCount(raw, "hardLimits") - parsed.hardLimits.length + (rawCount(raw, "preferences") - parsed.preferences.length) + (rawCount(raw, "killFacts") - parsed.killFacts.length);
    if (dropped > 0) warnings.push(`${dropped} malformed criterion(s) were dropped (missing id, label, metric or weight). Fix them and save again to keep them.`);
    if (countCriteria(parsed) === 0) return { ok: false, errors: ["The mandate has no usable criteria."], warnings, readBySkills };
    if ((raw as Record<string, unknown>).status === "approved") warnings.push("Status was reset to draft — a mandate is approved only with the Approve action.");
    const normalized: MandateTests = { status: "draft", hardLimits: parsed.hardLimits, preferences: parsed.preferences, killFacts: parsed.killFacts };
    return { ok: true, normalized: normalized as unknown as Record<string, unknown>, errors: [], warnings, mandateIssues: auditMandate(normalized), readBySkills };
  }

  if (key === "returns") {
    const p = parseReturnsHurdles(raw);
    if (!p) return fail('No usable base hurdle. Expected { "base": { "irr": 0.2, "moic": 2.5 }, "downside": {…}, "holdYears": 5 } with IRR as a decimal.');
    if (p.base.irr !== undefined && p.base.irr >= 1) warnings.push("Base IRR is 100% or more — IRR is a decimal (0.2 = 20%). Check this.");
    return { ok: true, normalized: p as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  if (key === "financing") {
    const p = parseFinancingPolicy(raw);
    if (!p) return fail("No usable financing values. Expected positive numbers such as maxSeniorLeverage, covenantWarnHeadroomPct (percent), liquidityMinimum.");
    return { ok: true, normalized: p as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  if (key === "kpi") {
    const p = parseKpiPolicy(raw);
    if (!p) return fail("No usable KPI values. Expected materialityPct (percent), optionally materialityAbs and trendPeriods.");
    return { ok: true, normalized: p as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  if (key === "ic_memo") {
    const { structure, dropped, customKeys } = parseMemoStructure(raw);
    for (const d of dropped) warnings.push(d);
    if (!structure) return { ok: false, errors: [`No usable sections. Expected { "sections": [ { "key": "recommendation", "title": "Recommendation", "required": true }, … ] } — up to ${MAX_MEMO_SECTIONS} sections, titles up to ${MAX_TITLE_CHARS} characters.`], warnings, readBySkills };
    if (customKeys.length) warnings.push(`The IC memo skill cannot generate: ${customKeys.join(", ")}. They will appear as open placeholders to fill in by hand; nothing is invented for them.`);
    return { ok: true, normalized: structure as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  if (key === "evidence") {
    const { policy, uIgnored } = parseEvidencePolicyDetailed(raw);
    if (uIgnored) warnings.push('Grade "U" (untested) can never support a price and cannot be changed; that value was ignored.');
    if (!policy) return { ok: false, errors: ['No usable evidence policy. Expected { "supportsPrice": { "A": true, "B": true, "C": false } } with true/false for at least one of A, B, C.'], warnings, readBySkills };
    if (!policy.supportsPrice.A) warnings.push("Grade A (audited / contractual) is set NOT to support a price — the strictest setting; check this is intended.");
    if (policy.supportsPrice.C) warnings.push("Grade C (management assertion without support) is set to support a price. The standing rule is that it cannot.");
    return { ok: true, normalized: policy as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  if (key === "firm") {
    const p = parseFirmFile(raw);
    if (p.unknownKeys.length) warnings.push(`Unknown gate(s) ignored: ${p.unknownKeys.join(", ")}. Known gates: ${GATE_KEYS.join(", ")}.`);
    if (p.droppedOwners.length) warnings.push(`Owner name over ${MAX_OWNER_CHARS} characters was dropped for: ${p.droppedOwners.join(", ")}.`);
    if (!p.firm) return { ok: false, errors: ['No usable firm values. Expected { "firmName": "…", "gateOwners": { "first_look": "Jane Doe, deal lead" } } with at least one name filled in.'], warnings, readBySkills };
    return { ok: true, normalized: p.firm as unknown as Record<string, unknown>, errors: [], warnings, readBySkills };
  }

  // Untyped files: plain object, stored as given, with the honest note.
  warnings.push("Stored as written. No skill reads this file yet.");
  return { ok: true, normalized: raw as Record<string, unknown>, errors: [], warnings, readBySkills };
}

/** A mandate may be approved only when it has criteria and no blocker remains. Returns the blocking reasons. */
export function mandateApprovalBlockers(m: MandateTests | null): string[] {
  if (!m || countCriteria(m) === 0) return ["There is no mandate to approve."];
  return auditMandate(m).filter((i) => i.severity === "blocker").map((i) => i.message);
}
