"use client";

import { useState } from "react";
import { SigningSheet } from "@/components/signing/SigningSheet";
import type { SigningData } from "./page";

// The recipient's screen for a document the owner placed signature blocks on.
export function PdfSigning({ data, token }: { data: SigningData; token: string }) {
  const [signedAt, setSignedAt] = useState<string | null>(null);

  if (signedAt) {
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-8 text-center">
        <h2 className="mb-2 text-2xl font-bold text-fg-primary">Signed and sent back</h2>
        <p className="text-fg-secondary">{data.documentTitle}</p>
        <p className="mt-2 text-sm text-fg-muted">
          Signed by {data.recipientName} on{" "}
          {new Date(signedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}. The sender will countersign, and you will be emailed the finished document.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-fg-primary">{data.documentTitle}</h1>
        <p className="text-sm text-fg-secondary">
          Signing as {data.recipientName} <span className="text-fg-muted">({data.recipientEmail})</span>
        </p>
      </div>
      <SigningSheet
        pdfSrc={`/api/sign/${token}/pdf`}
        blocks={data.blocks}
        done={[]}
        signerName={data.recipientName}
        submitLabel="Sign and send back"
        onSubmit={async (signatureData, fieldResponses) => {
          const res = await fetch(`/api/sign/${token}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signatureData, fieldResponses }),
          });
          if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server error ${res.status}`;
          setSignedAt(new Date().toISOString());
          return null;
        }}
      />
    </div>
  );
}
