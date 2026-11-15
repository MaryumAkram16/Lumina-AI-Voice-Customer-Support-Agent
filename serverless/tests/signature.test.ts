import { createHmac } from 'node:crypto';
import { Retell } from 'retell-sdk';
import { describe, expect, it } from 'vitest';
import { signRetellBody, verifyRetellSignature } from '../lib/signature.js';
import { API_KEY } from './helpers.js';

const BODY = JSON.stringify({ order_id: 'ORD-TEST-001', intent: 'track_order' });

/** The documented format, computed independently of the SDK. */
function manualSignature(body: string, key: string, timestamp: number): string {
  const digest = createHmac('sha256', key).update(`${body}${timestamp}`).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

describe('Retell signature verification', () => {
  it('accepts a signature produced by the official SDK', async () => {
    expect(await verifyRetellSignature(BODY, API_KEY, await Retell.sign(BODY, API_KEY))).toBe(true);
    expect(await verifyRetellSignature(BODY, API_KEY, await signRetellBody(BODY, API_KEY))).toBe(
      true,
    );
  });

  it('matches the wire format v=<ms>,d=<hmac-sha256(body + timestamp)>', async () => {
    const signature = manualSignature(BODY, API_KEY, Date.now());
    expect(await verifyRetellSignature(BODY, API_KEY, signature)).toBe(true);
    expect(await Retell.verify(BODY, API_KEY, signature)).toBe(true);
  });

  it('rejects a missing, empty or malformed header', async () => {
    for (const header of [null, '', 'abc', 'v=1,d=zz', 'Bearer token', `d=${'a'.repeat(64)}`]) {
      expect(await verifyRetellSignature(BODY, API_KEY, header)).toBe(false);
    }
  });

  it('rejects a body changed after signing', async () => {
    const signature = await signRetellBody(BODY, API_KEY);
    expect(await verifyRetellSignature(BODY.replace('001', '002'), API_KEY, signature)).toBe(false);
    expect(await verifyRetellSignature(`${BODY} `, API_KEY, signature)).toBe(false);
  });

  it('rejects a signature made with another key', async () => {
    const signature = await signRetellBody(BODY, 'key_some_other_workspace');
    expect(await verifyRetellSignature(BODY, API_KEY, signature)).toBe(false);
  });

  it('rejects a tampered digest or timestamp', async () => {
    const now = Date.now();
    const good = manualSignature(BODY, API_KEY, now);
    const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    expect(await verifyRetellSignature(BODY, API_KEY, flipped)).toBe(false);
    expect(
      await verifyRetellSignature(BODY, API_KEY, good.replace(`v=${now}`, `v=${now + 1}`)),
    ).toBe(false);
  });

  it('rejects a replayed signature older than five minutes', async () => {
    const stale = manualSignature(BODY, API_KEY, Date.now() - 6 * 60 * 1000);
    const future = manualSignature(BODY, API_KEY, Date.now() + 6 * 60 * 1000);
    expect(await verifyRetellSignature(BODY, API_KEY, stale)).toBe(false);
    expect(await verifyRetellSignature(BODY, API_KEY, future)).toBe(false);
  });

  it('never verifies with an empty key', async () => {
    expect(await verifyRetellSignature(BODY, '', manualSignature(BODY, '', Date.now()))).toBe(
      false,
    );
  });
});
