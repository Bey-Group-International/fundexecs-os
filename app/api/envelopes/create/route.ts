import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { Resend } from 'resend'

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
      .eq('user_id', user.id)
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

    // Insert 'created' event
    const { error: createdEventError } = await supabase.from('envelope_events').insert({
      envelope_id: envelopeId,
      event_type: 'created',
      created_by: user.id,
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
        created_by: user.id,
      })

      if (sentEventError) {
        console.error('sentEventError', sentEventError)
      }

      // Send emails via Resend if configured
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

        const emailPromises = insertedRecipients.map((recipient) => {
          const signingLink = `${appUrl}/sign/${recipient.signing_token}`
          const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: sans-serif; background: #f9fafb; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="font-size: 20px; color: #111827; margin: 0 0 16px;">You have a document to sign</h1>
    <p style="color: #374151; font-size: 15px; margin: 0 0 8px;">Hi ${recipient.name},</p>
    <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">
      You have been asked to review and sign: <strong>${title}</strong>.
    </p>
    ${
      message
        ? `<p style="color: #6b7280; font-size: 14px; background: #f3f4f6; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 0 0 24px; border-radius: 4px;">${message}</p>`
        : ''
    }
    <a href="${signingLink}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 600;">
      Review &amp; Sign Document
    </a>
    <p style="color: #9ca3af; font-size: 12px; margin: 32px 0 0;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <a href="${signingLink}" style="color: #2563eb;">${signingLink}</a>
    </p>
  </div>
</body>
</html>`

          return resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL ?? 'noreply@fundexecs.com',
            to: recipient.email,
            subject: `Please sign: ${title}`,
            html: htmlBody,
          })
        })

        const emailResults = await Promise.allSettled(emailPromises)
        emailResults.forEach((result, i) => {
          if (result.status === 'rejected') {
            console.error(`Failed to send email to ${insertedRecipients[i].email}:`, result.reason)
          }
        })
      }
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
