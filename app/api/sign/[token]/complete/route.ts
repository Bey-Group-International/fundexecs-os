import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { missingRequiredFields, type EnvelopeFieldRequirement } from '@/lib/envelope-signing'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { parseSignaturePng } from '@/lib/signing/signature-image'
import { blockValueProblem, resolveDateTimeResponse } from '@/lib/signing/blocks'

export const runtime = 'nodejs'

interface CompleteBody {
  signatureData: string
  initialsData?: string
  fieldResponses?: Record<string, string>
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getIpAddress(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const limiter = checkRateLimit({
      key: `ip:${getIpAddress(request) ?? 'unknown'}:sign-complete:${token}`,
      limit: 20,
      windowMs: 60_000,
    })
    if (!limiter.ok) {
      return NextResponse.json(
        { ok: false, error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(limiter, 20) },
      )
    }
    const supabase = getServiceClient()

    // Parse body
    let body: CompleteBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { signatureData, initialsData, fieldResponses } = body

    if (!signatureData || typeof signatureData !== 'string') {
      return NextResponse.json({ ok: false, error: 'signatureData is required' }, { status: 400 })
    }
    // The signature must be a real, small PNG: it is stamped onto the document.
    if (!parseSignaturePng(signatureData)) {
      return NextResponse.json({ ok: false, error: 'signatureData must be a PNG image' }, { status: 400 })
    }
    // Initials are only needed when the document has an initials block (checked with
    // the required fields below).
    if (initialsData !== undefined && typeof initialsData !== 'string') {
      return NextResponse.json({ ok: false, error: 'initialsData must be an image' }, { status: 400 })
    }
    const responses: Record<string, string> =
      fieldResponses && typeof fieldResponses === 'object' ? fieldResponses : {}

    // Look up recipient by signing_token
    const { data: recipient, error: recipientError } = await supabase
      .from('envelope_recipients')
      .select('id, status, envelope_id')
      .eq('signing_token', token)
      .limit(1)
      .maybeSingle()

    if (recipientError) {
      console.error('POST /api/sign/[token]/complete recipientError:', recipientError)
      return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
    }

    if (!recipient) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    // Fetch envelope to check status
    const { data: envelope, error: envelopeError } = await supabase
      .from('envelopes')
      .select('id, status, lp_session_id')
      .eq('id', recipient.envelope_id)
      .single()

    if (envelopeError || !envelope) {
      console.error('POST /api/sign/[token]/complete envelopeError:', envelopeError)
      return NextResponse.json({ ok: false, error: 'Envelope not found' }, { status: 404 })
    }

    // Signing again (a retry after a dropped response, a double click) is not an error.
    if (recipient.status === 'signed' && envelope.status !== 'voided') {
      return NextResponse.json({ ok: true, envelopeCompleted: envelope.status === 'completed', alreadySigned: true })
    }

    // Status gates. Signatures are only acceptable while the envelope is
    // actually out for signing — an explicit allow-list (sent /
    // partially_signed) so any state this code doesn't know about fails
    // closed instead of slipping through. Previously only 'voided' was
    // rejected, so a draft that was never dispatched (recipient tokens are
    // minted at create time) or an already-completed envelope would take a
    // signature.
    if (envelope.status !== 'sent' && envelope.status !== 'partially_signed') {
      if (envelope.status === 'voided') {
        return NextResponse.json(
          { ok: false, error: 'This document has been voided.' },
          { status: 410 }
        )
      }
      if (envelope.status === 'draft') {
        return NextResponse.json(
          { ok: false, error: 'This document has not been sent for signing yet.' },
          { status: 409 }
        )
      }
      if (envelope.status === 'completed') {
        return NextResponse.json(
          { ok: false, error: 'This document has already been completed.' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { ok: false, error: 'This document is not available for signing.' },
        { status: 409 }
      )
    }

    // A declined recipient made a recorded decision — flipping it to signed
    // via a replayed link would contradict the audit trail.
    if (recipient.status === 'declined') {
      return NextResponse.json(
        { ok: false, error: 'This signature request was declined and can no longer be signed.' },
        { status: 409 }
      )
    }

    // Required-field enforcement: the signing UI validates these client-side,
    // but the server is what makes the signed record defensible.
    const { data: fieldRows, error: fieldsError } = await supabase
      .from('envelope_fields')
      .select('id, field_type, label, required, prefill, locked')
      .eq('recipient_id', recipient.id)

    if (fieldsError) {
      console.error('POST /api/sign/[token]/complete fieldsError:', fieldsError)
      return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
    }

    const fieldList = (fieldRows ?? []) as (EnvelopeFieldRequirement & { prefill?: string | null; locked?: boolean })[]
    // What the server decides, not the browser: a locked block keeps the owner's value,
    // and a date-and-time block is stamped with the moment of signing.
    const stampedAt = new Date().toISOString()
    // A date and time starts at now and the signer may set it; the true moment is kept in the event below.
    const adjustedTimes: { chosen: string }[] = []
    for (const f of fieldList) {
      if (f.field_type === 'datetime') {
        // An optional date and time the signer left alone stays blank.
        if (!f.required && !(responses[f.id] ?? '').trim()) {
          delete responses[f.id]
          continue
        }
        const r = resolveDateTimeResponse(responses[f.id], stampedAt)
        if (r.problem) return NextResponse.json({ ok: false, error: r.problem }, { status: 400 })
        responses[f.id] = r.value
        if (r.adjusted && r.chosen) adjustedTimes.push({ chosen: r.chosen })
      } else if (f.locked && f.prefill) responses[f.id] = f.prefill
    }
    const missing = missingRequiredFields(fieldList, {
      signatureData,
      initialsData: initialsData ?? null,
      fieldResponses: responses,
    })
    if (missing.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Required fields are incomplete: ${missing.join(', ')}` },
        { status: 400 }
      )
    }

    for (const f of fieldList) {
      const problem = blockValueProblem(f.field_type, responses[f.id])
      if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 })
    }

    const ipAddress = getIpAddress(request)
    const now = new Date().toISOString()

    // Everything is written in one database transaction under a lock on the envelope: the
    // answers, the signature, the event and the roll-up to partially signed / completed.
    // It either all happens or none of it does, and signing twice changes nothing.
    const { data: result, error: rpcError } = await supabase.rpc('record_envelope_signature', {
      p_recipient_id: recipient.id,
      p_responses: responses,
      p_signature: signatureData,
      p_initials: initialsData ?? null,
      p_ip: ipAddress,
      p_now: now,
      // When the signer set the printed date and time, the true signing moment is kept beside it.
      p_event_metadata: adjustedTimes.length
        ? { datetime_chosen: adjustedTimes.map((t) => t.chosen), datetime_actual: stampedAt }
        : null,
    })
    if (rpcError || !result) {
      console.error('POST /api/sign/[token]/complete record_envelope_signature error:', rpcError)
      return NextResponse.json({ ok: false, error: 'Failed to record signature' }, { status: 500 })
    }
    const outcome = result as { ok: boolean; code?: string; status?: string; already?: boolean; completed?: boolean }
    if (!outcome.ok) {
      if (outcome.code === 'declined') {
        return NextResponse.json(
          { ok: false, error: 'This signature request was declined and can no longer be signed.' },
          { status: 409 },
        )
      }
      if (outcome.code === 'status' && outcome.status === 'voided') {
        return NextResponse.json({ ok: false, error: 'This document has been voided.' }, { status: 410 })
      }
      return NextResponse.json({ ok: false, error: 'This document is not available for signing.' }, { status: 409 })
    }
    // Signed a moment earlier (a retry, or a double click): nothing more to do.
    if (outcome.already) {
      return NextResponse.json({ ok: true, envelopeCompleted: Boolean(outcome.completed), alreadySigned: true })
    }
    const envelopeCompleted = Boolean(outcome.completed)

    // Tell the owner it is their turn (or, if this was the last signature, send the signed copy).
    try {
      const { after } = await import('next/server')
      const lpSessionId = (envelope as { lp_session_id?: string | null }).lp_session_id
      if (lpSessionId) {
        const { onLpAgreementSigned } = await import('@/lib/lp-agreement.server')
        after(() => onLpAgreementSigned(supabase as never, lpSessionId).catch(() => undefined))
      }
      const { notifyOwnerToCountersign, notifyCompleted } = await import('@/lib/envelope-notify.server')
      if (envelopeCompleted) {
        // The signed copy is built and kept first, so the link in the email opens at once and
        // everyone is given the same file.
        const { keepExecutedCopy } = await import('@/lib/signing/executed-envelope.server')
        after(async () => {
          await keepExecutedCopy(supabase as never, envelope.id).catch((e) => console.error('[sign/complete] could not keep the executed copy', e))
          await notifyCompleted(envelope.id).catch(() => undefined)
        })
      } else {
        after(() => notifyOwnerToCountersign(envelope.id).catch(() => undefined))
      }
    } catch {
      // Outside a request (tests): there is nothing to schedule.
    }

    return NextResponse.json({ ok: true, envelopeCompleted })
  } catch (err) {
    console.error('POST /api/sign/[token]/complete error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
