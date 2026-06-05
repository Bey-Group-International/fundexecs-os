/* End-to-end smoke for Phase 5 Chain of Trust as the seeded
   `test+investment_firm@fundexecs-staging.dev` (org owner).

   1. Pick a deal we haven't touched yet.
   2. startChainOfTrust({deal}) → creates record + 4 proof_layers.
   3. Insert an `evidence` row pointing at a storage path.
   4. Upload a tiny .txt file via storage.from('trust-evidence').upload (admin/service-role).
   5. Finalize: set uploaded_at, run AI validation (Anthropic if key present; fallback otherwise).
   6. Approve the evidence → proof_layers.truth → 'approved', chain.current_layer → 'Proof of Concept', profiles.xp += 15.
   7. Verify after-state.

   Direct DB writes via service-role to mirror what the server actions do
   end-to-end. */
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!URL || !SVC) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(URL, SVC, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws }
});

const ORG_ID = '145668b7-f739-4b5a-9207-f479b94b197b';
const USER_ID = '28bebb95-ab79-4039-b604-8db44d4be4b3';

(async () => {
  console.log('===== PHASE 5 E2E SMOKE =====');

  // BEFORE counts
  const counts = async (label) => {
    const tables = ['chain_of_trust_records', 'proof_layers', 'evidence', 'trust_events'];
    const out = {};
    for (const t of tables) {
      const { count } = await admin.from(t).select('*', { count: 'exact', head: true });
      out[t] = count;
    }
    const { data: pf } = await admin.from('profiles').select('xp').eq('id', USER_ID).single();
    out['profiles.xp(IF)'] = pf?.xp ?? null;
    console.log(label, JSON.stringify(out));
    return out;
  };
  const before = await counts('BEFORE');

  // 1. Pick a deal — sourcing stage, no chain yet.
  const { data: deals } = await admin
    .from('deals')
    .select('id, name, stage')
    .eq('org_id', ORG_ID)
    .eq('stage', 'sourcing')
    .limit(1);
  if (!deals?.length) {
    console.error('No sourcing-stage deal found.');
    process.exit(1);
  }
  const deal = deals[0];
  console.log('PICKED DEAL:', JSON.stringify(deal));

  // Detect existing chain (idempotency check)
  const { data: existingChain } = await admin
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('entity_type', 'deal')
    .eq('entity_id', deal.id)
    .maybeSingle();
  if (existingChain) {
    console.error('Deal already has a chain. Pick a fresh one.');
    process.exit(1);
  }

  // 2. startChainOfTrust
  const { data: chainRow, error: chainErr } = await admin
    .from('chain_of_trust_records')
    .insert({
      org_id: ORG_ID,
      entity_type: 'deal',
      entity_id: deal.id,
      current_layer: 'Proof of Truth',
      completion_percentage: 0,
      status: 'active'
    })
    .select('id')
    .single();
  if (chainErr) {
    console.error('startChain failed:', chainErr.message);
    process.exit(1);
  }
  const recordId = chainRow.id;
  console.log('CHAIN CREATED:', recordId);

  const LAYERS = [
    { name: 'Proof of Truth', order: 1 },
    { name: 'Proof of Concept', order: 2 },
    { name: 'Proof of Execution', order: 3 },
    { name: 'Proof of Work', order: 4 }
  ];
  const { error: layersErr } = await admin.from('proof_layers').insert(
    LAYERS.map((l) => ({
      org_id: ORG_ID,
      chain_record_id: recordId,
      layer_name: l.name,
      layer_order: l.order,
      required_documents: [],
      required_tasks: [],
      human_approval_status: 'pending',
      completion_percentage: 0
    }))
  );
  if (layersErr) {
    console.error('layers insert failed:', layersErr.message);
    process.exit(1);
  }

  // 3. Insert evidence row for Proof of Truth
  const { data: truthLayer } = await admin
    .from('proof_layers')
    .select('id')
    .eq('chain_record_id', recordId)
    .eq('layer_name', 'Proof of Truth')
    .single();
  const evidenceId = randomUUID();
  const fileName = 'thesis-memo.txt';
  const storagePath = `${ORG_ID}/${recordId}/${evidenceId}/${fileName}`;
  const fileBuf = Buffer.from(
    'Investment thesis: vertical SaaS rollup, North America focus. ' +
      'TAM ~$4B, fragmented incumbents, 30%+ EBITDA margins post-integration.',
    'utf8'
  );

  const { error: insErr } = await admin.from('evidence').insert({
    id: evidenceId,
    org_id: ORG_ID,
    proof_layer_id: truthLayer.id,
    uploaded_by: USER_ID,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: 'text/plain',
    size_bytes: fileBuf.byteLength,
    approval_status: 'pending'
  });
  if (insErr) {
    console.error('evidence insert failed:', insErr.message);
    process.exit(1);
  }
  console.log('EVIDENCE ROW INSERTED:', evidenceId);

  // 4. Upload the file to storage at the canonical path (service-role upload)
  const { error: upErr } = await admin.storage
    .from('trust-evidence')
    .upload(storagePath, fileBuf, { contentType: 'text/plain', upsert: false });
  if (upErr) {
    console.error('storage upload failed:', upErr.message);
    process.exit(1);
  }
  console.log('STORAGE UPLOAD OK at', storagePath);

  // 5. Finalize: set uploaded_at + run AI validation
  await admin
    .from('evidence')
    .update({ uploaded_at: new Date().toISOString() })
    .eq('id', evidenceId);

  let aiNotes = 'AI validation unavailable; proceed with manual review.';
  if (ANTHROPIC) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: process.env.EARN_MODEL || 'claude-sonnet-4-6',
          max_tokens: 250,
          system: 'You are Earn, COO. Validate evidence for a Proof of Truth layer. <=120 words.',
          messages: [
            {
              role: 'user',
              content: `Reviewing ${fileName} (text/plain, ${fileBuf.byteLength}B):\n"""\n${fileBuf.toString('utf8')}\n"""\nAssess for Proof of Truth.`
            }
          ]
        })
      });
      if (r.ok) {
        const j = await r.json();
        const txt = (j.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (txt) aiNotes = txt;
        console.log('AI VALIDATION: OK (length=' + aiNotes.length + ')');
      } else {
        console.log('AI VALIDATION: api failure', r.status, (await r.text()).slice(0, 200));
      }
    } catch (e) {
      console.log('AI VALIDATION: exception, falling back —', e.message);
    }
  } else {
    console.log('AI VALIDATION: no ANTHROPIC_API_KEY — using fallback note (never-block)');
  }
  await admin
    .from('evidence')
    .update({ ai_validation_notes: aiNotes, ai_validated_at: new Date().toISOString() })
    .eq('id', evidenceId);

  // 6. Approve evidence → advance Proof of Truth → 'approved', advance chain → Concept, award XP
  const now = new Date().toISOString();
  await admin
    .from('evidence')
    .update({
      approval_status: 'approved',
      approved_by: USER_ID,
      approved_at: now
    })
    .eq('id', evidenceId);

  // Mark proof layer approved + 100%
  await admin
    .from('proof_layers')
    .update({ human_approval_status: 'approved', completion_percentage: 100 })
    .eq('id', truthLayer.id);

  // Advance chain
  await admin
    .from('chain_of_trust_records')
    .update({ current_layer: 'Proof of Concept', completion_percentage: 25 })
    .eq('id', recordId);

  // Award +15 XP (Proof of Truth)
  const { data: pf2 } = await admin.from('profiles').select('xp').eq('id', USER_ID).single();
  const newXp = (pf2?.xp ?? 0) + 15;
  await admin.from('profiles').update({ xp: newXp }).eq('id', USER_ID);

  // Audit row
  await admin.from('trust_events').insert({
    org_id: ORG_ID,
    actor_id: USER_ID,
    entity_type: 'evidence',
    entity_id: evidenceId,
    action: 'evidence_approved',
    metadata: { layer_advanced: true, layer: 'truth' }
  });

  console.log('APPROVAL APPLIED — recordId:', recordId, 'evidenceId:', evidenceId);

  // 7. AFTER counts + verification
  const after = await counts('AFTER ');

  // Verify proof_layer truth is approved
  const { data: layerCheck } = await admin
    .from('proof_layers')
    .select('layer_name, human_approval_status, completion_percentage')
    .eq('chain_record_id', recordId)
    .order('layer_order');
  console.log('LAYERS AFTER:', JSON.stringify(layerCheck));

  // Verify chain
  const { data: chainAfter } = await admin
    .from('chain_of_trust_records')
    .select('current_layer, completion_percentage')
    .eq('id', recordId)
    .single();
  console.log('CHAIN AFTER:', JSON.stringify(chainAfter));

  // Deltas
  const delta = {
    chain_of_trust_records: after.chain_of_trust_records - before.chain_of_trust_records,
    proof_layers: after.proof_layers - before.proof_layers,
    evidence: after.evidence - before.evidence,
    trust_events: after.trust_events - before.trust_events,
    xp_delta: after['profiles.xp(IF)'] - before['profiles.xp(IF)']
  };
  console.log('DELTAS:', JSON.stringify(delta));

  process.exit(0);
})().catch((e) => {
  console.error('UNCAUGHT:', e.message);
  console.error(e.stack);
  process.exit(1);
});
