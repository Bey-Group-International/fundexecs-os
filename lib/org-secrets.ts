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

// The Supabase client has no default request timeout, so a hung vault read
// holds its caller open forever — and an unsettled promise is not something a
// try/catch can rescue. Every read on a request path must be bounded.
export const VAULT_READ_TIMEOUT_MS = 3_000;

export function withVaultTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} vault read timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * `getOrgSecret` under a deadline. A timeout resolves to null — the same shape
 * as "no secret stored" — so a slow vault degrades a send to its unconnected
 * path instead of hanging the request that triggered it.
 */
export async function getOrgSecretBounded(
  orgId: string,
  provider: string,
  ms: number = VAULT_READ_TIMEOUT_MS,
): Promise<string | null> {
  try {
    return await withVaultTimeout(getOrgSecret(orgId, provider), ms, provider);
  } catch (err) {
    console.warn(`[org-secrets] ${provider} read failed for org ${orgId}:`, err);
    return null;
  }
}
