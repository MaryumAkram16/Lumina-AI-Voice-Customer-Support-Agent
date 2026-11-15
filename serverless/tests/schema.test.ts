import { describe, expect, it } from 'vitest';
import { cleanOrderId, parseRequestBody } from '../lib/schema.js';

function parse(body: unknown) {
  const result = parseRequestBody(body);
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.issues)}`);
  return result.request;
}

describe('request validation', () => {
  it('accepts the README request example', () => {
    expect(
      parse({
        order_id: 'ORD-12345',
        intent: 'track_order',
        email: 'Customer@Example.com',
        phone_no: '+1-555-0100',
        customer_name: 'John Doe',
      }),
    ).toMatchObject({
      orderId: 'ORD-12345',
      orderIdWellFormed: true,
      intent: 'track_order',
      email: 'customer@example.com',
      phone: '+1-555-0100',
    });
  });

  it('accepts every argument the seven Retell functions send', () => {
    const request = parse({
      order_id: 'ORD-TEST-001',
      intent: 'cancel order',
      user_message: 'please cancel it',
      Phone_no: '+1-555-0101',
      email: '',
      reason: 'changed my mind',
      date: 'today',
      item_condition: 'unopened',
      refund_amount: 4500,
      cancellation_initiated: 'yes',
      return_initiated: 'no',
      refund_initiated: '',
      event_id: 'call_1:tool_2',
    });
    expect(request).toMatchObject({
      phone: '+1-555-0101',
      email: undefined,
      cancellationInitiated: 'yes',
      refundInitiated: undefined,
      eventId: 'call_1:tool_2',
    });
  });

  it('unwraps the full Retell body used when "args only" is off', () => {
    const request = parse({
      name: 'check_order',
      call: { call_id: 'call_abc123', agent_id: 'agent_1', transcript: 'User: hi' },
      args: { order_id: 'ORD-TEST-001', intent: 'track order' },
    });
    expect(request).toMatchObject({ orderId: 'ORD-TEST-001', callId: 'call_abc123' });
  });

  it('prefers phone_no over Phone_no when both are present', () => {
    expect(parse({ phone_no: '111-1111', Phone_no: '222-2222' }).phone).toBe('111-1111');
  });

  it('treats placeholders a language model sends as "not provided"', () => {
    for (const filler of ['', '  ', 'N/A', 'none', 'null', 'unknown', 'not provided', '-', null]) {
      const request = parse({ order_id: filler, email: filler, phone_no: filler });
      expect(request).toMatchObject({ orderId: null, email: undefined, phone: undefined });
    }
  });

  it.each([
    ['ord test 001', 'ORD-TEST-001'],
    [' ORD_TEST_001 ', 'ORD-TEST-001'],
    ['#12345', '12345'],
  ])('normalizes spoken order ID %j', (raw, expected) => {
    expect(cleanOrderId(raw)).toBe(expected);
    expect(parse({ order_id: raw }).orderIdWellFormed).toBe(true);
  });

  it.each([
    'A',
    "1' OR '1'='1",
    '=1+1',
    '../../etc/passwd',
    'ORD-TEST-001; DROP TABLE orders',
    '😀😀😀',
  ])('flags %j as not a real order ID', (raw) => {
    expect(parse({ order_id: raw }).orderIdWellFormed).toBe(false);
  });

  it.each([
    ['unknown field', { order_id: 'ORD-TEST-001', is_admin: true }],
    ['unknown field in args', { name: 'x', args: { order_id: 'ORD-TEST-001', role: 'admin' } }],
    ['unknown wrapper field', { args: {}, call: {}, extra: 1 }],
    ['prototype pollution', JSON.parse('{"order_id":"ORD-TEST-001","__proto__":{"admin":true}}')],
    ['wrong type', { order_id: 12345 }],
    ['nested object', { order_id: { $ne: null } }],
    ['array value', { order_id: ['ORD-TEST-001'] }],
    ['order ID too long', { order_id: 'A'.repeat(65) }],
    ['email too long', { email: `${'a'.repeat(250)}@example.test` }],
    ['reason too long', { reason: 'x'.repeat(501) }],
    ['bad event ID', { event_id: 'has spaces' }],
    ['array body', [{ order_id: 'ORD-TEST-001' }]],
    ['string body', 'ORD-TEST-001'],
    ['null body', null],
  ])('rejects %s', (_name, body) => {
    const result = parseRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('describes problems without echoing submitted values or unknown key names', () => {
    const result = parseRequestBody({ order_id: 999, secret_backdoor_key: 'alex@example.test' });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain('secret_backdoor_key');
    expect(text).not.toContain('alex@example.test');
    expect(text).toContain('order_id');
  });
});
