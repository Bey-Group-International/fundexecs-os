"use client";

import { useRouter } from "next/navigation";
import { SigningSheet, type DoneBlock, type SheetBlock } from "@/components/signing/SigningSheet";

// The owner's turn: the recipient's filled-in, signed document, with the owner's own blocks to fill.
export function Countersign({ envelopeId, title, defaultName, blocks, done, userId }: { envelopeId: string; title: string; defaultName: string; blocks: SheetBlock[]; done: DoneBlock[]; userId: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-display text-xl font-semibold text-fg-primary">Countersign: {title}</h1>
      <p className="mb-4 text-sm text-fg-secondary">The recipient has signed. Review their answers on the document, then add yours.</p>
      <SigningSheet
        pdfSrc={`/api/envelopes/${envelopeId}/pdf`}
        blocks={blocks}
        done={done}
        signerName={defaultName}
        rememberFor={userId}
        submitLabel="Countersign"
        onSubmit={async (signatureData, fieldResponses) => {
          const res = await fetch(`/api/envelopes/${envelopeId}/countersign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signatureData, fieldResponses, signerName: defaultName }),
          });
          if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server error ${res.status}`;
          router.push(`/envelopes/${envelopeId}`);
          router.refresh();
          return null;
        }}
      />
    </div>
  );
}
