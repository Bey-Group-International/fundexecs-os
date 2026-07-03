import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { sendEmail, buildSigningInvitationHtml } from '@/lib/email'

export const runtime = 'nodejs'

interface Recipient {
  name: string
  email: string
  routingOrder?: number
}

interface CreateEnvelopeBody {
  title: string
  message?: string
  documentContent: string
  recipients: Recipient[]
  send?: boolean
}

export async function POST(request: Request) {
  try {
    const body: CreateEnvelopeBody = await request.json()

    const { title, message, documentContent, recipients, send = false } = body

    // Validate required fields
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 })
    }
    if (!documentContent || typeof documentContent !== 'string') {
      return NextResponse.json({ ok: false, error: 'documentContent is required' }, { status: 400 })
    }
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ ok: false, error: 'recipients must be a non-empty array' }, { status: 400 })
    }
    for (const r of recipients) {
      if (!r.name || !r.email) {
        return NextResponse.json(
          { ok: false, error: 'each recipient must have name and email' },
          { status: 400 }
        )
      }
    }

    // Create Supabase server client
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {
              // Ignore — read-only context (middleware handles refresh)
            }
          },
        },
      }
    )

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's organization_id
    const { data: memberRow, error: memberError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('principal_id', user.id)
      .limit(1)
      .single()

    if (memberError || !memberRow) {
      return NextResponse.json(
        { ok: false, error: 'User does not belong to any organization' },
        { status: 400 }
      )
    }

    const organizationId = memberRow.organization_id

    // Insert envelope row
    const { data: envelope, error: envelopeError } = await supabase
      .from('envelopes')
      .insert({
        title: title.trim(),
        message: message ?? null,
        document_content: documentContent,
        organization_id: organizationId,
        created_by: user.id,
        status: 'draft',
      })
      .select('id')
      .single()

    if (envelopeError || !envelope) {
      console.error('envelopeError', envelopeError)
      return NextResponse.json(
        { ok: false, error: envelopeError?.message ?? 'Failed to create envelope' },
        { status: 500 }
      )
    }

    const envelopeId = envelope.id

    // Insert recipient rows
    const recipientRows = recipients.map((r, index) => ({
      envelope_id: envelopeId,
      name: r.name,
      email: r.email,
      routing_order: r.routingOrder ?? index + 1,
    }))

    const { data: insertedRecipients, error: recipientsError } = await supabase
      .from('envelope_recipients')
      .insert(recipientRows)
      .select('id, name, email, routing_order, signing_token')

    if (recipientsError || !insertedRecipients) {
      console.error('recipientsError', recipientsError)
      return NextResponse.json(
        { ok: false, error: recipientsError?.message ?? 'Failed to insert recipients' },
        { status: 500 }
      )
    }

    // Insert 'created' event. envelope_events has no created_by column
    // (20260701250000_envelopes.sql) — the actor rides in metadata, and the
    // old insert that named created_by errored (swallowed) on every create.
    const { error: createdEventError } = await supabase.from('envelope_events').insert({
      envelope_id: envelopeId,
      event_type: 'created',
      metadata: { actor: user.id },
    })

    if (createdEventError) {
      console.error('createdEventError', createdEventError)
    }

    // If send=true, update status and insert 'sent' event
    if (send) {
      const { error: updateError } = await supabase
        .from('envelopes')
        .update({ status: 'sent' })
        .eq('id', envelopeId)

      if (updateError) {
        console.error('updateError', updateError)
      }

      const { error: sentEventError } = await supabase.from('envelope_events').insert({
        envelope_id: envelopeId,
        event_type: 'sent',
        metadata: { actor: user.id },
      })

      if (sentEventError) {
        console.error('sentEventError', sentEventError)
      }

      // Send emails via Gmail or Resend (whichever is configured)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
      const emailPromises = insertedRecipients.map((recipient) => {
        const signingLink = `${appUrl}/sign/${recipient.signing_token}`
        return sendEmail({
          to: { name: recipient.name, email: recipient.email },
          subject: `Please sign: ${title}`,
          htmlBody: buildSigningInvitationHtml({
            recipientName: recipient.name,
            documentTitle: title,
            message,
            signingLink,
          }),
        }).then((result) => {
          if (!result.ok) {
            console.warn(`[envelopes/create] email to ${recipient.email} not sent via external channel (${result.detail}) — signing link available in-app`)
          }
        })
      })
      await Promise.allSettled(emailPromises)
    }

    return NextResponse.json({
      ok: true,
      envelopeId,
      recipients: insertedRecipients,
    })
  } catch (err) {
    console.error('POST /api/envelopes/create error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
