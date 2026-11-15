import { Retell } from 'retell-sdk';

/**
 * Creates a Retell web call for `agentId` and returns Retell's response,
 * which holds the short-lived access token the browser joins the call with.
 * The API key never leaves the server.
 */
export async function createRetellWebCall(
  apiKey: string,
  agentId: string,
): Promise<Record<string, unknown>> {
  const client = new Retell({ apiKey, timeout: 8000, maxRetries: 1 });
  const call = await client.call.createWebCall({ agent_id: agentId });
  return call as unknown as Record<string, unknown>;
}
