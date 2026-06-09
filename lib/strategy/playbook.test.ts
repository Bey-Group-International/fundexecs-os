import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_PLAYBOOK, playbookForStage } from './playbook';
import { LIFECYCLE_STAGES } from '@/lib/lifecycle';

test('every lifecycle stage has a playbook', () => {
  for (const stage of LIFECYCLE_STAGES) {
    assert.ok(playbookForStage(stage).length > 0, `stage ${stage} has templates`);
  }
});

test('every template is well-formed', () => {
  const tiers = new Set(['100', '30', '10']);
  const priorities = new Set(['high', 'medium', 'low']);
  const categories = new Set(['capital', 'governance', 'compliance', 'execution']);
  for (const templates of Object.values(STAGE_PLAYBOOK)) {
    for (const t of templates) {
      assert.ok(t.title.trim().length > 0, 'title non-empty');
      assert.ok(tiers.has(t.tier), `valid tier: ${t.tier}`);
      assert.ok(priorities.has(t.priority), `valid priority: ${t.priority}`);
      assert.ok(categories.has(t.category), `valid category: ${t.category}`);
      assert.ok(t.ownerSlug.trim().length > 0, 'ownerSlug non-empty');
      assert.ok(t.timeline.trim().length > 0, 'timeline non-empty');
    }
  }
});

// Owner slugs are validated against the roster in lib/team/roster.ts, but that
// module pulls in UI deps (lucide-react) that don't load under the react-server
// test condition — so the slug↔roster check lives in the e2e/typecheck layer.
// draftStrategyObjectives falls back to "Your team" on an unknown slug anyway.

test('titles are unique within a stage (so drafting can dedupe by title)', () => {
  for (const [stage, templates] of Object.entries(STAGE_PLAYBOOK)) {
    const titles = new Set(templates.map((t) => t.title));
    assert.equal(titles.size, templates.length, `no duplicate titles in ${stage}`);
  }
});
