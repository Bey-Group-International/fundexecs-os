// Coverage for the e-sign completion hardening (audit P1 #18): the handler
// used to accept a signature on any non-voided envelope — including drafts
// that were never sent (recipient tokens are minted at create time) and
// already-completed envelopes — never read envelope_fields to enforce
// required fields, let declined recipients sign, and wrote field responses
// to a column that doesn't exist. These tests lock in the status gates, the
// required-field enforcement, and the correct response column.

const from = jest.fn();
const rpc = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import { toOffsetIso } from '@/lib/signing/blocks';
import { missingRequiredFields } from '@/lib/envelope-signing';

interface ScriptedTables {
  recipient?: { id: string; status: string; envelope_id: string } | null;
  envelope?: { id: string; status: string } | null;
  fields?: { id: string; field_type: string; label: string | null; required: boolean }[];
  allRecipients?: { id: string; status: string }[];
  /** What the signing function answers; defaults to a plain success. */
  recorded?: Record<string, unknown> | null;
  recordedError?: { message: string } | null;
}

// Stateful stub keyed by table: selects resolve to the scripted rows; updates
// and inserts are recorded for assertions and resolve to { error: null }.
function makeSupabase(script: ScriptedTables) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];

  rpc.mockResolvedValue({
    data: script.recorded === undefined ? { ok: true, already: false, completed: false } : script.recorded,
    error: script.recordedError ?? null,
  });

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
// A real 1x1 PNG: the server only accepts signatures that are actual, small PNG images.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const GOOD_BODY = { signatureData: PNG, initialsData: PNG };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

describe('POST /api/sign/[token]/complete', () => {
  it('rejects a signature that is not a real PNG image', async () => {
    makeSupabase({});
    for (const bad of ['sig', 'data:image/png;base64,AAAA', 'data:text/html;base64,PGI+']) {
      const res = await POST(request({ signatureData: bad }), params);
      expect(res.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('does not require initials unless the document has an initials block', async () => {
    makeSupabase({
      recipient: { id: 'r1', status: 'pending', envelope_id: 'e1' },
      envelope: { id: 'e1', status: 'sent' },
      fields: [],
      allRecipients: [{ id: 'r1', status: 'signed' }],
    });
    const res = await POST(request({ signatureData: PNG }), params);
    expect(res.status).toBe(200);
  });

  it('requires initials when the document has an initials block', async () => {
    makeSupabase({
      recipient: { id: 'r1', status: 'pending', envelope_id: 'e1' },
      envelope: { id: 'e1', status: 'sent' },
      fields: [{ id: 'f1', field_type: 'initials', label: 'Initials', required: true }],
    });
    const res = await POST(request({ signatureData: PNG }), params);
    expect(res.status).toBe(400);
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

  it('fails closed on an unrecognized envelope status (allow-list, not deny-list)', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'pending', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'expired' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('not available for signing');
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

  it('records the signature in one database call, with every answer', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [{ id: 'f-1', field_type: 'text', label: 'Title', required: true }],
      recorded: { ok: true, already: false, completed: true },
    });
    const res = await POST(request({ ...GOOD_BODY, fieldResponses: { 'f-1': 'Managing Partner' } }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, envelopeCompleted: true });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('record_envelope_signature');
    expect(args).toMatchObject({
      p_recipient_id: 'rec-1',
      p_responses: { 'f-1': 'Managing Partner' },
      p_signature: GOOD_BODY.signatureData,
      p_initials: GOOD_BODY.initialsData,
      p_event_metadata: null,
    });
    // No other writes: the single call is the whole record.
    expect(from.mock.calls.every(([t]) => t === 'envelope_recipients' || t === 'envelopes' || t === 'envelope_fields')).toBe(true);
  });

  it('reports a multi-signer envelope as not yet complete', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [],
      recorded: { ok: true, already: false, completed: false },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, envelopeCompleted: false });
  });

  it('is harmless to sign twice: a retry gets success and writes nothing', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'signed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'completed' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, envelopeCompleted: true, alreadySigned: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats a signature that lost the race to its own twin as done', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      recorded: { ok: true, already: true, completed: false },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(200);
    expect((await res.json()).alreadySigned).toBe(true);
  });

  it('maps the function refusing (declined / voided / other) onto the right status', async () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ ok: false, code: 'declined' }, 409],
      [{ ok: false, code: 'status', status: 'voided' }, 410],
      [{ ok: false, code: 'status', status: 'completed' }, 409],
    ];
    for (const [recorded, status] of cases) {
      makeSupabase({
        recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
        envelope: { id: 'env-1', status: 'sent' },
        recorded,
      });
      expect((await POST(request(GOOD_BODY), params)).status).toBe(status);
    }
  });

  it('fails with 500 when the database call fails, rather than claiming success', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      recorded: null,
      recordedError: { message: 'connection reset' },
    });
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(500);
  });

  it('keeps the true signing moment when the signer set a different date and time', async () => {
    makeSupabase({
      recipient: { id: 'rec-1', status: 'viewed', envelope_id: 'env-1' },
      envelope: { id: 'env-1', status: 'sent' },
      fields: [{ id: 'f-1', field_type: 'datetime', label: 'Date', required: true }],
    });
    const chosen = toOffsetIso(new Date(Date.now() - 3 * 3600_000));
    const res = await POST(request({ ...GOOD_BODY, fieldResponses: { 'f-1': chosen } }), params);
    expect(res.status).toBe(200);
    const meta = rpc.mock.calls[0][1].p_event_metadata;
    expect(meta.datetime_chosen).toHaveLength(1);
    expect(typeof meta.datetime_actual).toBe('string');
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

  it('does not let a required checkbox pass on a non-affirmative response like "false"', () => {
    expect(
      missingRequiredFields(
        [{ id: 'f-1', field_type: 'checkbox', label: 'I agree', required: true }],
        { ...sig, fieldResponses: { 'f-1': 'false' } },
      ),
    ).toEqual(['I agree']);
  });

  it('accepts a required checkbox for affirmative checked values', () => {
    for (const value of ['true', 'checked', 'on', '1', ' TRUE ']) {
      expect(
        missingRequiredFields(
          [{ id: 'f-1', field_type: 'checkbox', label: 'I agree', required: true }],
          { ...sig, fieldResponses: { 'f-1': value } },
        ),
      ).toEqual([]);
    }
  });
});
