import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectSpeakable, makeApp, send } from './helpers.js';

const root = new URL('../../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const workflow = JSON.parse(
  readFileSync(new URL('Lumina_AI_Voice_Customer_Support_Agent..json', root), 'utf8'),
) as {
  nodes: { name: string; parameters: { assignments?: { assignments: { name: string }[] } } }[];
};
const retellAgent = readFileSync(
  new URL('Lumina_AI_Voice_Customer_Support_Agent_Retell..json', root),
  'utf8',
);

/** The JSON code blocks under "API Reference" in the main README. */
function readmeExamples(): { request: Record<string, unknown>; response: Record<string, unknown> } {
  const section = readme.slice(readme.indexOf('## API Reference'));
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map(
    (match) => JSON.parse(match[1] ?? '{}') as Record<string, unknown>,
  );
  const [request, response] = blocks;
  if (!request || !response) throw new Error('README API Reference examples not found');
  return { request, response };
}

/** The field each n8n "Prepare ... Message" node sends back to Retell. */
function n8nResponseField(nodeName: string): string {
  const node = workflow.nodes.find((n) => n.name === nodeName);
  const field = node?.parameters.assignments?.assignments[0]?.name;
  if (!field) throw new Error(`n8n node not found: ${nodeName}`);
  return field;
}

describe('contract with the README API reference', () => {
  const { request, response } = readmeExamples();

  it('accepts the documented request body on every route', async () => {
    const { app } = makeApp();
    expect(Object.keys(request)).toEqual([
      'order_id',
      'intent',
      'email',
      'phone_no',
      'customer_name',
    ]);
    for (const route of ['track_order', 'order'] as const) {
      const reply = await send(app, route, request);
      expect(reply.status).toBe(200);
    }
  });

  it('returns every documented response field with the documented type', async () => {
    const { app } = makeApp();
    const reply = await send(app, 'track_order', {
      order_id: 'ORD-TEST-001',
      intent: 'track_order',
      email: 'alex@example.test',
      phone_no: '+1-555-0101',
      customer_name: 'Alex Example',
    });
    expect(reply.status).toBe(200);
    expect(Object.keys(response)).toEqual([
      'success',
      'status',
      'tracking_number',
      'carrier',
      'delivery_date',
    ]);
    for (const [field, example] of Object.entries(response)) {
      expect(reply.body, `missing ${field}`).toHaveProperty(field);
      expect(typeof reply.body[field], `type of ${field}`).toBe(typeof example);
    }
    expect(reply.body).toMatchObject({
      success: true,
      status: 'shipped',
      tracking_number: '1ZTEST00000000001',
      carrier: 'UPS',
      delivery_date: '2026-12-31',
    });
    // Same date format as the README example (YYYY-MM-DD).
    expect(reply.body.delivery_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('contract with the n8n workflow responses', () => {
  const cases = [
    {
      node: 'Prepare Message for Response',
      route: 'track_order',
      body: { order_id: 'ORD-TEST-001', intent: 'track order', email: 'alex@example.test' },
    },
    {
      node: 'Prepare Cancellation Status Message',
      route: 'cancel_order',
      body: { order_id: 'ORD-TEST-004', intent: 'cancel order', email: 'jordan@example.test' },
    },
    {
      node: 'Prepare Return Eligibility Message',
      route: 'return_item',
      body: { order_id: 'ORD-TEST-005', intent: 'return', email: 'casey@example.test' },
    },
    {
      node: 'Prepare Refund Status Message',
      route: 'refund_order',
      body: { order_id: 'ORD-TEST-006', intent: 'refund', email: 'riley@example.test' },
    },
  ] as const;

  it.each(cases)(
    '$route returns the field n8n node "$node" returns',
    async ({ node, route, body }) => {
      const { app } = makeApp();
      const field = n8nResponseField(node);
      const found = await send(app, route, body);
      const missing = await send(app, route, { ...body, order_id: 'ORD-TEST-999' });
      for (const reply of [found, missing]) {
        expect(reply.status).toBe(200);
        expect(typeof reply.body[field]).toBe('string');
        expect(reply.body[field]).toBe(reply.body.message);
        // The Retell flow prompts read this exact key.
        expect(retellAgent).toContain(field);
      }
    },
  );

  it('uses the n8n field names: message, cancelMessage and "return message"', () => {
    expect(n8nResponseField('Prepare Message for Response')).toBe('message');
    expect(n8nResponseField('Prepare Cancellation Status Message')).toBe('cancelMessage');
    expect(n8nResponseField('Prepare Return Eligibility Message')).toBe('return message');
    expect(n8nResponseField('Prepare Refund Status Message')).toBe('message');
  });

  it('confirmation responses carry `message`, like the n8n confirmation nodes', async () => {
    const { app } = makeApp();
    const replies = await Promise.all([
      send(app, 'cancel_order', {
        order_id: 'ORD-TEST-004',
        intent: 'cancel order',
        email: 'jordan@example.test',
        reason: 'changed my mind',
        cancellation_initiated: 'yes',
      }),
      send(app, 'return_item', {
        order_id: 'ORD-TEST-005',
        intent: 'return',
        email: 'casey@example.test',
        reason: 'too small',
        item_condition: 'unopened',
        return_initiated: 'yes',
      }),
      send(app, 'refund_order', {
        order_id: 'ORD-TEST-006',
        intent: 'refund',
        email: 'riley@example.test',
        refund_amount: '12999',
        refund_initiated: 'yes',
      }),
    ]);
    for (const reply of replies) {
      expect(reply.status).toBe(200);
      expect(reply.body.success).toBe(true);
      expectSpeakable(reply.body.message);
    }
  });

  it('every response, success or error, has `success` and a speakable `message`', async () => {
    const { app } = makeApp();
    const replies = [
      await send(app, 'track_order', { order_id: 'ORD-TEST-001' }),
      await send(app, 'track_order', { order_id: 'ORD-TEST-999' }),
      await send(app, 'track_order', {}),
      await send(app, 'cancel_order', { order_id: 'ORD-TEST-004' }),
      await send(app, 'order', { order_id: 'ORD-TEST-001', intent: 'billing' }),
      await send(app, 'track_order', { order_id: 'ORD-TEST-001' }, { signature: false }),
      await send(app, 'track_order', { nope: 1 }),
      await send(app, 'track_order', {}, { method: 'GET' }),
    ];
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 400, 401, 400, 405]);
    for (const reply of replies) {
      expect(typeof reply.body.success).toBe('boolean');
      expect(typeof reply.body.request_id).toBe('string');
      expectSpeakable(reply.body.message);
      expect(reply.headers.get('content-type')).toBe('application/json; charset=utf-8');
    }
  });
});
