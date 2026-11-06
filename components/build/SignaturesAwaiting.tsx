import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import type { SignatureTask } from "@/lib/data-room-signatures";
import { CountersignForm } from "@/components/build/CountersignForm";
import { SignaturesList } from "@/components/build/SignaturesList";

/**
 * The Signatures tab: every file across the organization's rooms that is waiting
 * on the fund's signature. The caller loads the tasks (it also needs the count for
 * the tab); this adds who may sign.
 */
export async function SignaturesAwaiting({
  tasks,
  error,
  currentRoomId,
}: {
  tasks: SignatureTask[];
  /** Set when the list could not be loaded. */
  error?: string | null;
  currentRoomId: string;
}) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const canSign = canAdminOrg(ctx.role) && ctx.emailConfirmed && Boolean(ctx.email);

  return (
    <SignaturesList
      tasks={tasks}
      error={error}
      currentRoomId={currentRoomId}
      canSign={canSign}
      legacyAction={(t) => <CountersignForm signatureId={t.id} fileName={t.title} />}
      envelopeAction={(t) => (
        <Link href={`/envelopes/${t.id}`} className="fx-btn-primary inline-flex min-h-9 items-center">
          Open and counter-sign
        </Link>
      )}
    />
  );
}
