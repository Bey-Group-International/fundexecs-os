import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVATION_ORDER,
  DEFAULT_MANDATE,
  MANDATE_BY_GROUP,
  ROLE_GROUPS,
  TEAM,
  activationHeadline,
  groupDefaults,
  identityRoleFor,
  mandateCfg,
  memberTypeFor,
  orgTypeFor,
  specialistById,
  suggestFirmName,
  workspaceStats,
  type InvestorGroup,
  type Mandate
} from './mandate';

const GROUPS: InvestorGroup[] = ['fund', 'capital', 'service'];

/* ── member-type mapping ─────────────────────────────────────────────────── */

test('memberTypeFor maps each role family to a canonical member type', () => {
  assert.equal(memberTypeFor('fund', 'General Partner'), 'investment_firm');
  assert.equal(memberTypeFor('capital', 'Limited Partner'), 'individual_investor');
  assert.equal(memberTypeFor('service', 'Legal Counsel'), 'service_provider');
});

test('memberTypeFor routes a student-led fund to the student member type', () => {
  assert.equal(memberTypeFor('fund', 'Student-led fund'), 'student');
  // ...but only within the fund family.
  assert.equal(memberTypeFor('capital', 'Student-led fund'), 'individual_investor');
});

/* ── org-type + identity-role mapping ────────────────────────────────────── */

test('orgTypeFor maps each role family to an org_type', () => {
  assert.equal(orgTypeFor('fund'), 'fund');
  assert.equal(orgTypeFor('capital'), 'lp');
  assert.equal(orgTypeFor('service'), 'service_provider');
});

test('identityRoleFor returns a role on the save_onboarding_identity whitelist', () => {
  const allowed = new Set([
    'managing_partner',
    'principal',
    'operator',
    'limited_partner',
    'capital_provider',
    'advisor'
  ]);
  for (const g of GROUPS) {
    assert.ok(allowed.has(identityRoleFor(g)), `${g} → ${identityRoleFor(g)} not whitelisted`);
  }
  assert.equal(identityRoleFor('capital'), 'limited_partner');
  assert.equal(identityRoleFor('service'), 'advisor');
  assert.equal(identityRoleFor('fund'), 'managing_partner');
});

/* ── config integrity ────────────────────────────────────────────────────── */

test('every role group has a mandate config and a default role', () => {
  for (const g of ROLE_GROUPS) {
    const cfg = MANDATE_BY_GROUP[g.id];
    assert.ok(cfg, `missing config for ${g.id}`);
    assert.ok(g.roles.length > 0, `${g.id} has no roles`);
    assert.ok(cfg.objectives.length > 0 && cfg.vehicles.length > 0 && cfg.sizes.length > 0);
  }
});

test('mandateCfg falls back to the fund config for an unknown group', () => {
  assert.equal(mandateCfg('nope' as InvestorGroup), MANDATE_BY_GROUP.fund);
});

test('groupDefaults returns ids that exist in that group config', () => {
  for (const g of GROUPS) {
    const d = groupDefaults(g);
    const cfg = mandateCfg(g);
    assert.ok(cfg.objectives.some((o) => o.id === d.objective));
    assert.ok(cfg.vehicles.some((v) => v.id === d.vehicle));
    assert.ok(cfg.sizes.some((s) => s.id === d.size));
  }
});

test('groupDefaults prefers the recommended option when one exists', () => {
  const cfg = mandateCfg('fund');
  const recommendedObjective = cfg.objectives.find((o) => o.recommended)?.id;
  assert.equal(groupDefaults('fund').objective, recommendedObjective);
});

/* ── working-title suggestions ───────────────────────────────────────────── */

test('suggestFirmName is stable, non-empty, and wraps safely on any seed', () => {
  assert.equal(suggestFirmName(0), suggestFirmName(0));
  for (const seed of [0, 3, 99, -1, -50]) {
    assert.ok(suggestFirmName(seed).length > 0, `empty name for seed ${seed}`);
  }
});

/* ── team + activation ───────────────────────────────────────────────────── */

test('every activation specialist resolves to a team member', () => {
  for (const id of ACTIVATION_ORDER) {
    const m = specialistById(id);
    assert.ok(m, `activation id ${id} has no TEAM entry`);
    assert.ok(m.name && m.title && m.icon && m.build);
  }
});

test('specialistById returns undefined for an unknown id', () => {
  assert.equal(specialistById('nobody'), undefined);
  assert.ok(TEAM.length >= ACTIVATION_ORDER.length);
});

test('the activation desk is structurally complete and roster-linked', () => {
  // name + title are sourced from lib/team/roster.ts (the single source of
  // truth) by `slug`; this guard can't import the roster (it pulls lucide,
  // which the react-server test condition can't evaluate), so it enforces the
  // structural invariants that catch the likely regressions: a missing member,
  // a duplicate, a dropped field, or an unlinked entry. Name/title equality to
  // the roster is owned by the `slug` linkage + review.
  assert.equal(TEAM.length, 14, 'the desk is the 15-strong roster minus Earn the COO');
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const s of TEAM) {
    assert.ok(s.id && s.slug && s.name && s.title && s.icon && s.build, `${s.id} missing a field`);
    assert.ok(!slugs.has(s.slug), `duplicate slug ${s.slug}`);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    slugs.add(s.slug);
    ids.add(s.id);
  }
  // Every member shown building during activation resolves to a desk entry.
  for (const id of ACTIVATION_ORDER)
    assert.ok(specialistById(id), `activation id ${id} has no entry`);
});

test('workspaceStats reflects the mandate and always returns four tiles', () => {
  const fund: Mandate = { ...DEFAULT_MANDATE, investorGroup: 'fund', size: '500' };
  const fundStats = workspaceStats(fund);
  assert.equal(fundStats.length, 4);
  assert.equal(fundStats[0].label, 'Raise target');
  assert.equal(fundStats[0].value, '$500M');

  const capital: Mandate = {
    ...DEFAULT_MANDATE,
    investorGroup: 'capital',
    objective: 'portfolio',
    vehicle: 'fundcommit',
    size: '250'
  };
  const capStats = workspaceStats(capital);
  assert.equal(capStats[0].label, 'Capital to deploy');
  assert.equal(capStats[0].value, '$250M');
});

test('activationHeadline greets by first name and degrades gracefully', () => {
  assert.equal(
    activationHeadline({ ...DEFAULT_MANDATE, principal: 'Jordan Avery' }),
    'Your desk is ready, Jordan.'
  );
  assert.equal(
    activationHeadline({ ...DEFAULT_MANDATE, principal: '' }),
    'Your desk is ready, there.'
  );
});
