import { createClient } from "@supabase/supabase-js";
import SigningExperience from "./SigningExperience";
import { PdfSigning } from "./PdfSigning";

export const dynamic = "force-dynamic";

export interface SigningData {
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  documentId: string;
  documentTitle: string;
  documentContent: string;
  envelopeId: string;
  envelopeStatus: string;
  signingToken: string;
  status: string;
  signedAt: string | null;
  /** The envelope has a PDF the owner placed signature blocks on. */
  hasPdf: boolean;
  blocks: {
    id: string; type: string; page: number; xPct: number; yPct: number;
    widthPct: number; heightPct: number; required: boolean; prefill: string | null; locked: boolean;
  }[];
}

async function fetchSigningData(token: string): Promise<SigningData | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: recipient, error } = await supabase
    .from("envelope_recipients")
    .select(`id, name, email, status, signed_at, envelope_id,
      envelopes (id, title, document_content, message, status, pdf_storage_key)`)
    .eq("signing_token", token)
    .limit(1)
    .maybeSingle();

  if (error || !recipient) return null;

  const env = recipient.envelopes as unknown as {
    id: string; title: string; document_content: string;
    message: string | null; status: string; pdf_storage_key: string | null;
  } | null;
  if (!env || env.status === "voided") return null;

  const { data: fieldRows } = await supabase
    .from("envelope_fields")
    .select("id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked")
    .eq("recipient_id", recipient.id as string);
  const blocks = ((fieldRows ?? []) as {
    id: string; field_type: string; page: number; x_pct: number; y_pct: number;
    width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean;
  }[]).map((f) => ({
    id: f.id, type: f.field_type, page: f.page, xPct: f.x_pct, yPct: f.y_pct,
    widthPct: f.width_pct, heightPct: f.height_pct, required: f.required, prefill: f.prefill, locked: f.locked,
  }));

  return {
    hasPdf: Boolean(env.pdf_storage_key),
    blocks,
    recipientId: recipient.id as string,
    recipientName: recipient.name as string,
    recipientEmail: recipient.email as string,
    documentId: env.id,
    documentTitle: env.title,
    // The page is the PDF; its text is not sent to the browser a second time.
    documentContent: env.pdf_storage_key ? "" : env.document_content,
    envelopeId: env.id,
    envelopeStatus: env.status,
    signingToken: token,
    status: recipient.status as string,
    signedAt: (recipient.signed_at as string | null) ?? null,
  };
}

export default async function SignPage(
  props: {
    params: Promise<{ token: string }>;
  }
) {
  const params = await props.params;
  const { token } = params;
  const signingData = await fetchSigningData(token);

  if (!signingData) {
    return (
      <SignPageShell>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-2xl font-semibold text-fg-primary mb-2">
            Signing Link Not Found
          </h1>
          <p className="text-fg-secondary">
            This signing link is invalid or has expired. Please contact the
            sender for a new link.
          </p>
        </div>
      </SignPageShell>
    );
  }

  // Recipient tokens are minted while the envelope is still a draft — the
  // completion API rejects never-sent drafts, so don't render a signable UI
  // for one either.
  if (signingData.envelopeStatus === "draft") {
    return (
      <SignPageShell>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="text-2xl font-semibold text-fg-primary mb-2">
            Not Ready for Signing
          </h1>
          <p className="text-fg-secondary">
            This document has not been sent for signing yet. Please contact the
            sender.
          </p>
        </div>
      </SignPageShell>
    );
  }

  if (signingData.status === "signed" || signingData.signedAt) {
    return (
      <SignPageShell>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-semibold text-fg-primary mb-2">
            Already Signed
          </h1>
          <p className="text-fg-secondary">
            This document was already signed on{" "}
            {signingData.signedAt
              ? new Date(signingData.signedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "a previous date"}
            .
          </p>
          <p className="text-fg-muted mt-2 text-sm">
            Please contact the sender if you have questions.
          </p>
        </div>
      </SignPageShell>
    );
  }

  return (
    <SignPageShell wide={signingData.hasPdf}>
      {signingData.hasPdf ? (
        <PdfSigning data={signingData} token={token} />
      ) : (
        <SigningExperience data={signingData} token={token} />
      )}
    </SignPageShell>
  );
}

function SignPageShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-surface-0 flex flex-col">
      {/* Header bar */}
      <header className="border-b border-line bg-surface-1/90 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #C9A227, #F0C040)" }}
            >
              FE
            </div>
            <span className="text-fg-primary font-semibold text-sm tracking-wide">
              FundExecs
            </span>
          </div>
          <div className="h-4 w-px bg-line" />
          <span className="text-fg-secondary text-sm">Document Signing</span>
        </div>
      </header>

      {/* Page body */}
      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className={`w-full ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line py-4 text-center text-xs text-fg-muted">
        Powered by FundExecs &middot; Secure Document Signing
      </footer>
    </div>
  );
}
