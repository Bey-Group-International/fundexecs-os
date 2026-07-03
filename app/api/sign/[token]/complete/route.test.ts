// Coverage for the e-sign completion hardening (audit P1 #18): the handler
// used to accept a signature on any non-voided envelope — including drafts
// that were never sent (recipient tokens are minted at create time) and
// already-completed envelopes — never read envelope_fields to enforce
// required fields, let declined recipients sign, and wrote field responses
// to a column that doesn't exist. These tests lock in the status gates, the
// required-field enforcement, and the correct response column.

const from = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import { missingRequiredFields } from '@/lib/envelope-signing';

interface ScriptedTables {
  recipient?: { id: string; status: string; envelope_id: string } | null;
  envelope?: { id: string; status: string } | null;
  fields?: { id: string; field_type: string; label: string | null; required: boolean }[];
  allRecipients?: { id: string; status: string }[];
}

// Stateful stub keyed by table: selects resolve to the scripted rows; updates
// and inserts are recorded for assertions and resolve to { error: null }.
function makeSupabase(script: ScriptedTables) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];

  from.mockImplementation((table: string) => {
    let recipientSelects = 0;
    const b: Record<string, unknown> = {
      select: () => b,
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
      eq: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: script.recipient ?? null, error: null }),
      single: async () => ({ data: script.envelope ?? null, error: script.envelope ? null : { message: 'not found' } }),
      then: (onFulfilled: (v: unknown) => unknown) => {
        // Thenable chains: fields select, recipient/envelope updates, and the
        // all-recipients select. Updates resolve to { error: null }; selects
        // resolve to their scripted data.
        const lastUpdate = updates[updates.length - 1];
        let result: unknown;
        if (lastUpdate && lastUpdate.table === table) {
          result = { data: null, error: null };
          updates[updates.length - 1] = lastUpdate; // keep record
        }
        if (table === 'envelope_fields') {
          result = { data: script.fields ?? [], error: null };
        } else if (table === 'envelope_recipients') {
          recipientSelects++;
          result = { data: script.allRecipients ?? [], error: null };
        }
        if (result === undefined) result = { data: null, error: null };
        void recipientSelects;
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  });

  return { updates, inserts };
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sign/tok-1/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = { params: Promise.resolve({ token: 'tok-1' }) };
const GOOD_BODY = { signatureData: 'data:image/png;base64,SIG', initialsData: 'data:image/png;base64,INI' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

describe('POST /api/sign/[token]/complete', () => {
  it('rejects a missing initialsData (parity with the signing UI contract)', async () => {
    makeSupabase({});
    const res = await POST(request({ signatureData: 'sig' }), params);
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects signing a DRAFT envelope — recipient tokens exist before send', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'pending', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'draft' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('not been sent');
  });

  it('rejects signing an already-completed envelope', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'pending', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'completed' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(409);
  });

  it('still rejects a voided envelope with 410', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'pending', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'voided' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(410);
  });

  it('rejects a DECLINED recipient — a recorded decline cannot be flipped to signed', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'declined', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('declined');
  });

  it('rejects when a required text field has no response', async () => {
    const { updates } = makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [{ id: 'f-1', field_type: 'date', label: 'Effective date', required: true }],
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Effective date');
    expect(updates).toHaveLength(0); // nothing was written
  });

  it('completes a sent envelope: writes responses to the `response` column, signs the recipient, completes when all signed', async () => {
    const { updates, inserts } = makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [{ id: 'f-1', field_type: 'text', label: 'Title', required: true }],
      allRecipients: [{ id: 'rec-1', status: 'signed' }],
    });
    const res = await POST(request({ ...GOOD_BODY, fieldResponses: { 'f-1': 'Managing Partner' } }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, envelopeCompleted: true });

    const fieldUpdate = updates.find((u) => u.table === 'envelope_fields');
    expect(fieldUpdate?.patch).toEqual({ response: 'Managing Partner' });
    const recipientUpdate = updates.find((u) => u.table === 'envelope_recipients');
    expect(recipientUpdate?.patch).toMatchObject({ status: 'signed', signature_data: GOOD_BODY.signatureData });
    const envelopeUpdate = updates.find((u) => u.table === 'envelopes');
    expect(envelopeUpdate?.patch).toMatchObject({ status: 'completed' });
    expect(inserts.map((i) => i.row.event_type)).toEqual(['signed', 'completed']);
  });

  it('moves a multi-signer envelope to partially_signed after the first signature', async () => {
    const { updates } = makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [],
      allRecipients: [
        { id: 'rec-1', status: 'signed' },
        { id: 'rec-2', status: 'pending' },
      ],
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, envelopeCompleted: false });
    const envelopeUpdate = updates.find((u) => u.table === 'envelopes');
    expect(envelopeUpdate?.patch).toEqual({ status: 'partially_signed' });
  });
});

describe('missingRequiredFields', () => {
  const sig = { signatureData: 'sig', initialsData: 'ini', fieldResponses: {} as Record<string, string> };

  it('is satisfied by signature/initials images for those field types', () => {
    expect(
      missingRequiredFields(
        [
          { id: 'f-1', field_type: 'signature', label: null, required: true },
          { id: 'f-2', field_type: 'initials', label: null, required: true },
        ],
        sig,
      ),
    ).toEqual([]);
  });

  it('reports required text/date/checkbox fields with no or blank responses', () => {
    expect(
      missingRequiredFields(
        [
          { id: 'f-1', field_type: 'text', label: 'Title', required: true },
          { id: 'f-2', field_type: 'checkbox', label: null, required: true },
        ],
        { ...sig, fieldResponses: { 'f-1': '   ' } },
      ),
    ).toEqual(['Title', 'checkbox']);
  });

  it('ignores optional fields', () => {
    expect(
      missingRequiredFields([{ id: 'f-1', field_type: 'text', label: 'Notes', required: false }], sig),
    ).toEqual([]);
  });
});
