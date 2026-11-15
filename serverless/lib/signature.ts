import { Retell } from 'retell-sdk';

/** Header Retell sets on every custom-function request and webhook. */
export const SIGNATURE_HEADER = 'x-retell-signature';

/** `v=<unix ms>,d=<hex HMAC-SHA256 of body + timestamp>` (retell-sdk `webhook_auth`). */
const SIGNATURE_FORMAT = /^v=\d{1,16},d=[0-9a-f]{64}$/i;

/**
 * Verifies that a request was signed by Retell with our API key.
 *
 * Uses the official SDK (`Retell.verify(rawBody, apiKey, signature)`), which
 * also rejects signatures older than five minutes, so a captured request
 * cannot be replayed later. `rawBody` must be the exact bytes received, never
 * re-serialized JSON.
 */
export async function verifyRetellSignature(
  rawBody: string,
  apiKey: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !apiKey || !SIGNATURE_FORMAT.test(signature)) return false;
  try {
    return await Retell.verify(rawBody, apiKey, signature);
  } catch {
    return false;
  }
}

/** Signs a body the way Retell does. Used by the smoke test and the test suite. */
export function signRetellBody(rawBody: string, apiKey: string): Promise<string> {
  return Retell.sign(rawBody, apiKey);
}
