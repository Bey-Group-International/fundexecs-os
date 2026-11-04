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

    if (recipient.status === 'signed') {
      return NextResponse.json({ ok: false, error: 'Already signed.' }, { status: 409 })
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

    // Persist field responses BEFORE flipping the recipient to signed, so a
    // signed recipient can never exist with its responses still unwritten.
    // The answers are written together, not one round trip each.
    const writes = await Promise.all(
      Object.keys(responses).map(async (fieldId) => ({
        fieldId,
        ...(await supabase.from('envelope_fields').update({ response: responses[fieldId] }).eq('id', fieldId).eq('recipient_id', recipient.id)),
      })),
    )
    const failed = writes.find((w) => w.error)
    if (failed) {
      console.error(`POST /api/sign/[token]/complete field ${failed.fieldId} error:`, failed.error)
      return NextResponse.json({ ok: false, error: 'Failed to record field responses' }, { status: 500 })
    }

    // Update recipient to signed
    const { error: updateRecipientError } = await supabase
      .from('envelope_recipients')
      .update({
        status: 'signed',
        signed_at: now,
        signature_data: signatureData,
        initials_data: initialsData ?? null,
        ip_address: ipAddress,
      })
      .eq('id', recipient.id)

    if (updateRecipientError) {
      console.error('POST /api/sign/[token]/complete updateRecipientError:', updateRecipientError)
      return NextResponse.json({ ok: false, error: 'Failed to record signature' }, { status: 500 })
    }

    // Log 'signed' event
    const { error: signedEventError } = await supabase.from('envelope_events').insert({
      envelope_id: envelope.id,
      event_type: 'signed',
      recipient_id: recipient.id,
      ip_address: ipAddress,
      // When the signer set the printed date and time, the true signing moment is kept beside it.
      ...(adjustedTimes.length ? { metadata: { datetime_chosen: adjustedTimes.map((t) => t.chosen), datetime_actual: stampedAt } } : {}),
    })

    if (signedEventError) {
      console.error('POST /api/sign/[token]/complete signedEventError:', signedEventError)
    }

    // Check if ALL recipients are now signed
    const { data: allRecipients, error: allRecipientsError } = await supabase
      .from('envelope_recipients')
      .select('id, status')
      .eq('envelope_id', envelope.id)

    if (allRecipientsError) {
      console.error('POST /api/sign/[token]/complete allRecipientsError:', allRecipientsError)
      // Non-fatal: return success but envelopeCompleted unknown — treat as false
      return NextResponse.json({ ok: true, envelopeCompleted: false })
    }

    const allSigned =
      allRecipients.length > 0 && allRecipients.every((r) => r.status === 'signed')

    let envelopeCompleted = false

    if (allSigned) {
      const { error: completeError } = await supabase
        .from('envelopes')
        .update({ status: 'completed', completed_at: now })
        .eq('id', envelope.id)

      if (completeError) {
        console.error('POST /api/sign/[token]/complete completeError:', completeError)
      } else {
        envelopeCompleted = true

        const { error: completedEventError } = await supabase.from('envelope_events').insert({
          envelope_id: envelope.id,
          event_type: 'completed',
        })

        if (completedEventError) {
          console.error(
            'POST /api/sign/[token]/complete completedEventError:',
            completedEventError
          )
        }
      }
    } else if (envelope.status === 'sent') {
      // First signature in a multi-signer envelope: reflect the documented
      // lifecycle (draft → sent → partially_signed → completed) instead of
      // leaving the envelope on 'sent' until the very last signer.
      const { error: partialError } = await supabase
        .from('envelopes')
        .update({ status: 'partially_signed' })
        .eq('id', envelope.id)
      if (partialError) {
        console.error('POST /api/sign/[token]/complete partialError:', partialError)
      }
    }

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
