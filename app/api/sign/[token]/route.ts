import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const supabase = getServiceClient()

    // Look up recipient by signing_token, join envelope
    const { data: recipient, error: recipientError } = await supabase
      .from('envelope_recipients')
      .select(`
        id,
        name,
        email,
        status,
        envelope_id,
        envelopes (
          id,
          title,
          document_content,
          message,
          status
        )
      `)
      .eq('signing_token', token)
      .limit(1)
      .maybeSingle()

    if (recipientError) {
      console.error('GET /api/sign/[token] recipientError:', recipientError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!recipient) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const envelope = (recipient.envelopes as unknown) as {
      id: string
      title: string
      document_content: string
      message: string | null
      status: string
    } | null

    if (!envelope) {
      return NextResponse.json({ error: 'Envelope not found' }, { status: 404 })
    }

    if (envelope.status === 'voided') {
      return NextResponse.json(
        { error: 'This document has been voided and is no longer available for signing.' },
        { status: 410 }
      )
    }

    // Recipient tokens are minted when the envelope is still a draft — a
    // never-sent document isn't signable, so don't serve it to a signer.
    if (envelope.status === 'draft') {
      return NextResponse.json(
        { error: 'This document has not been sent for signing yet.' },
        { status: 409 }
      )
    }

    if (recipient.status === 'signed') {
      return NextResponse.json({ alreadySigned: true }, { status: 200 })
    }

    // Fetch fields for this recipient. Column names match the migration
    // (20260701250000_envelopes.sql) — this select used to name columns that
    // don't exist (x/y/width/height/value), so it errored on every request.
    const { data: fields, error: fieldsError } = await supabase
      .from('envelope_fields')
      .select('id, field_type, label, required, page, x_pct, y_pct, width_pct, height_pct, response')
      .eq('recipient_id', recipient.id)

    if (fieldsError) {
      console.error('GET /api/sign/[token] fieldsError:', fieldsError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    // Side effect: if pending → viewed
    if (recipient.status === 'pending') {
      const { error: updateError } = await supabase
        .from('envelope_recipients')
        .update({ status: 'viewed' })
        .eq('id', recipient.id)

      if (updateError) {
        console.error('GET /api/sign/[token] update to viewed error:', updateError)
      }

      const { error: eventError } = await supabase.from('envelope_events').insert({
        envelope_id: envelope.id,
        event_type: 'viewed',
        recipient_id: recipient.id,
      })

      if (eventError) {
        console.error('GET /api/sign/[token] viewed event error:', eventError)
      }
    }

    return NextResponse.json({
      envelope: {
        id: envelope.id,
        title: envelope.title,
        documentContent: envelope.document_content,
        message: envelope.message,
      },
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        status: recipient.status === 'pending' ? 'viewed' : recipient.status,
      },
      fields: fields ?? [],
    })
  } catch (err) {
    console.error('GET /api/sign/[token] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
