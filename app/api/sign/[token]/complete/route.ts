import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
      .select('id, status')
      .eq('id', recipient.envelope_id)
      .single()

    if (envelopeError || !envelope) {
      console.error('POST /api/sign/[token]/complete envelopeError:', envelopeError)
      return NextResponse.json({ ok: false, error: 'Envelope not found' }, { status: 404 })
    }

    if (envelope.status === 'voided') {
      return NextResponse.json(
        { ok: false, error: 'This document has been voided.' },
        { status: 410 }
      )
    }

    if (recipient.status === 'signed') {
      return NextResponse.json({ ok: false, error: 'Already signed.' }, { status: 409 })
    }

    const ipAddress = getIpAddress(request)
    const now = new Date().toISOString()

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

    // Update field responses if provided
    if (fieldResponses && typeof fieldResponses === 'object') {
      const fieldIds = Object.keys(fieldResponses)
      if (fieldIds.length > 0) {
        const updates = fieldIds.map((fieldId) =>
          supabase
            .from('envelope_fields')
            .update({ value: fieldResponses[fieldId] })
            .eq('id', fieldId)
            .eq('recipient_id', recipient.id)
        )
        const results = await Promise.allSettled(updates)
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            console.error(`Failed to update field ${fieldIds[i]}:`, result.reason)
          } else if (result.value.error) {
            console.error(`Failed to update field ${fieldIds[i]}:`, result.value.error)
          }
        })
      }
    }

    // Log 'signed' event
    const { error: signedEventError } = await supabase.from('envelope_events').insert({
      envelope_id: envelope.id,
      event_type: 'signed',
      recipient_id: recipient.id,
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
