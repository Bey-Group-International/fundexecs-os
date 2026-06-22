// Server-side retrieval for the third-party secret vault. The dispatch / engine
// layers call getOrgSecret to pull a decrypted provider credential at the moment
// of use — the plaintext lives only in memory for that call and is never sent to
// the browser. Reads go through the service-role client so background work
// (cron, the task engine) can resolve secrets without a user session; callers
// must therefore pass the org id explicitly and are responsible for scoping.
import { createServiceClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/vault";

/**
 * Resolve a stored third-party secret to its plaintext, or null if absent or if
 * the vault key is unconfigured. Decryption failures (tampering, wrong key)
 * surface as a thrown error from decryptSecret.
 */
export async function getOrgSecret(
  orgId: string,
  provider: string,
): Promise<string | null> {
  if (!process.env.FUNDEXECS_VAULT_KEY) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("org_secrets")
    .select("ciphertext, iv, auth_tag")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) return null;
  return decryptSecret({
    ciphertext: data.ciphertext,
    iv: data.iv,
    authTag: data.auth_tag,
  });
}
