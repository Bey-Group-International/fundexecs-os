import { createClient } from "@supabase/supabase-js";
import SigningExperience from "./SigningExperience";

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
}

async function fetchSigningData(token: string): Promise<SigningData | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: recipient, error } = await supabase
    .from("envelope_recipients")
    .select(`id, name, email, status, signed_at, envelope_id,
      envelopes (id, title, document_content, message, status)`)
    .eq("signing_token", token)
    .limit(1)
    .maybeSingle();

  if (error || !recipient) return null;

  const env = recipient.envelopes as unknown as {
    id: string; title: string; document_content: string;
    message: string | null; status: string;
  } | null;
  if (!env || env.status === "voided") return null;

  return {
    recipientId: recipient.id as string,
    recipientName: recipient.name as string,
    recipientEmail: recipient.email as string,
    documentId: env.id,
    documentTitle: env.title,
    documentContent: env.document_content,
    envelopeId: env.id,
    envelopeStatus: env.status,
    signingToken: token,
    status: recipient.status as string,
    signedAt: (recipient.signed_at as string | null) ?? null,
  };
}

export default async function SignPage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;
  const signingData = await fetchSigningData(token);

  if (!signingData) {
    return (
      <SignPageShell>
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-2xl font-semibold text-white mb-2">
            Signing Link Not Found
          </h1>
          <p className="text-slate-400">
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
          <h1 className="text-2xl font-semibold text-white mb-2">
            Not Ready for Signing
          </h1>
          <p className="text-slate-400">
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
          <h1 className="text-2xl font-semibold text-white mb-2">
            Already Signed
          </h1>
          <p className="text-slate-400">
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
          <p className="text-slate-500 mt-2 text-sm">
            Please contact the sender if you have questions.
          </p>
        </div>
      </SignPageShell>
    );
  }

  return (
    <SignPageShell>
      <SigningExperience data={signingData} token={token} />
    </SignPageShell>
  );
}

function SignPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#05090F] flex flex-col">
      {/* Header bar */}
      <header className="border-b border-white/10 bg-[#0A111F]/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #C9A227, #F0C040)" }}
            >
              FE
            </div>
            <span className="text-white font-semibold text-sm tracking-wide">
              FundExecs
            </span>
          </div>
          <div className="h-4 w-px bg-white/20" />
          <span className="text-slate-400 text-sm">Document Signing</span>
        </div>
      </header>

      {/* Page body */}
      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-3xl">{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-4 text-center text-xs text-slate-600">
        Powered by FundExecs &middot; Secure Document Signing
      </footer>
    </div>
  );
}
