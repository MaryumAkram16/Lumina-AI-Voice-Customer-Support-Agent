/**
 * End to end through the real Vercel route modules (`api/*.ts`), configured
 * from environment variables, on the demo adapter, with requests shaped and
 * signed the way Retell sends them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_KEY, expectSpeakable, retellRequest } from './helpers.js';

type Handler = (request: Request) => Response | Promise<Response>;
type RouteModule = Record<
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  Handler
>;

const routes: Record<string, RouteModule> = {};
const logLines: string[] = [];

beforeAll(async () => {
  vi.stubEnv('RETELL_API_KEY', API_KEY);
  vi.stubEnv('DATA_SOURCE', '');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('RATE_LIMIT_MAX_PER_IP', '1000');
  vi.resetModules();
  // Imported after the environment is stubbed, so each module builds its app from it.
  const load = (module: Promise<unknown>) => module as Promise<RouteModule>;
  routes.health = await load(import('../api/health.js'));
  routes['track-order'] = await load(import('../api/track-order.js'));
  routes['cancel-order'] = await load(import('../api/cancel-order.js'));
  routes['return-item'] = await load(import('../api/return-item.js'));
  routes['refund-eligibility'] = await load(import('../api/refund-eligibility.js'));
  routes.order = await load(import('../api/order.js'));
});

beforeEach(() => {
  // Re-applied per test because the vitest config restores mocks between tests.
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logLines.push(line);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function call(
  name: string,
  payload: unknown,
  options: Parameters<typeof retellRequest>[2] = {},
) {
  const method = (options.method ?? 'POST') as keyof RouteModule;
  const handler = routes[name]?.[method];
  if (!handler) throw new Error(`no handler for ${method} ${name}`);
  const response = await handler(await retellRequest(`/api/${name}`, payload, options));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('route modules', () => {
  it('export a handler for every HTTP method', () => {
    for (const module of Object.values(routes)) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const) {
        expect(typeof module[method]).toBe('function');
      }
    }
  });

  it('GET /api/health reports the data source and nothing sensitive', async () => {
    const reply = await call('health', null, { method: 'GET', signature: false });
    expect(reply).toEqual({
      status: 200,
      body: { status: 'ok', service: 'lumina-serverless', data_source: 'demo', web_call: false },
    });
    expect((await call('health', {}, { method: 'POST' })).status).toBe(405);
  });
});

describe('a full call, as Retell would make it ("args only" payload)', () => {
  it('check_order: tracks a shipped order', async () => {
    const reply = await call('track-order', {
      order_id: 'ORD-TEST-001',
      intent: 'track order',
      user_message: 'where is my order',
      Phone_no: '',
      email: 'alex@example.test',
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      success: true,
      status: 'shipped',
      carrier: 'UPS',
      tracking_number: '1ZTEST00000000001',
      delivery_date: '2026-12-31',
      customer_name: 'Alex Example',
    });
    expect(reply.body.message).toBe(
      'Hi Alex Example. Your order is currently shipped with UPS. It is expected on 31 December 2026. The latest update is: in transit.',
    );
    expectSpeakable(reply.body.message);
  });

  it('check_order: understands an order number as it is spoken', async () => {
    const reply = await call('track-order', { order_id: 'ord test 002', intent: 'track order' });
    expect(reply.body).toMatchObject({ success: true, status: 'processing', delivery_date: null });
    expect(reply.body.message).toContain("doesn't have a delivery date yet");
  });

  it('check_order: gives a safe answer for an unknown order and a missing order number', async () => {
    const unknown = await call('track-order', { order_id: 'ORD-TEST-999', intent: 'track order' });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ success: false, outcome: 'not_found' });
    expect(unknown.body).not.toHaveProperty('status');

    const missing = await call('track-order', { order_id: '', intent: 'track order' });
    expect(missing.body).toMatchObject({ success: false, outcome: 'validation_error' });
    expect(missing.body.message).toMatch(/order number/);
  });

  it('cancel_order_status then cancel_order_initiated, then a repeat', async () => {
    const base = {
      order_id: 'ORD-TEST-004',
      intent: 'cancel order',
      reason: 'ordered by mistake',
      phone_no: '+1-555-0104',
      email: '',
    };
    const check = await call('cancel-order', base);
    expect(check.body).toMatchObject({
      success: true,
      canCancel: true,
      cancelMessage: 'Order can be cancelled before the delivery date.',
    });

    const confirm = { ...base, date: 'today', cancellation_initiated: 'yes' };
    const done = await call('cancel-order', confirm);
    expect(done.body).toMatchObject({ success: true, status: 'cancelled' });
    expect(done.body.message).toMatch(/^Your order was cancelled on \d{1,2} \w+ \d{4}\./);
    expectSpeakable(done.body.message);

    const repeat = await call('cancel-order', confirm);
    expect(repeat.body).toMatchObject({ success: true, duplicate: true });
    expect(repeat.body.message).toBe(done.body.message);

    const after = await call('cancel-order', base);
    expect(after.body).toMatchObject({
      canCancel: false,
      cancelMessage: 'This order has already been cancelled.',
    });
    const tracked = await call('track-order', { order_id: 'ORD-TEST-004', intent: 'track order' });
    expect(tracked.body).toMatchObject({
      status: 'cancelled',
      message: 'Your order has been cancelled.',
    });
  });

  it('cancel_order_status: explains why an order cannot be cancelled', async () => {
    const noDate = await call('cancel-order', {
      order_id: 'ORD-TEST-002',
      intent: 'cancel order',
      email: 'sam@example.test',
    });
    expect(noDate.body).toMatchObject({
      canCancel: false,
      cancelMessage: 'Delivery date is missing. Cannot cancel order.',
    });
    const delivered = await call('cancel-order', {
      order_id: 'ORD-TEST-003',
      intent: 'cancel order',
      email: 'taylor@example.test',
    });
    expect(delivered.body.canCancel).toBe(false);
  });

  it('return_order_status then return_order_initiated', async () => {
    const base = {
      order_id: 'ORD-TEST-005',
      intent: 'return',
      reason: 'wrong colour',
      item_condition: 'unopened',
      phone_no: '',
      email: 'casey@example.test',
    };
    const check = await call('return-item', base);
    expect(check.body).toMatchObject({
      success: true,
      canReturn: true,
      'return message': 'Order is eligible for return.',
      daysSinceDelivery: 3,
    });

    const done = await call('return-item', { ...base, return_initiated: 'yes' });
    expect(done.body).toMatchObject({ success: true, returnStatus: 'initiated' });
    expect(done.body.message).toContain(
      'Your return for the Wireless Headphones has been started.',
    );

    const expired = await call('return-item', {
      order_id: 'ORD-TEST-003',
      intent: 'return',
      email: 'taylor@example.test',
    });
    expect(expired.body).toMatchObject({
      canReturn: false,
      'return message': 'Return period has expired.',
    });
  });

  it('refund_order_status then refund_order_initiated, following the return', async () => {
    // ORD-TEST-005 had its return initiated in the previous test, so it now qualifies.
    const base = {
      order_id: 'ORD-TEST-005',
      intent: 'refund',
      Phone_no: '',
      email: 'casey@example.test',
    };
    const check = await call('refund-eligibility', base);
    expect(check.body).toMatchObject({ success: true, canRefund: true, refundAmount: '4500' });
    expect(check.body.message).toContain('is eligible for a refund of 4500 PKR');

    const done = await call('refund-eligibility', {
      ...base,
      phone_no: '',
      refund_amount: '4500',
      refund_initiated: 'yes',
    });
    expect(done.body).toMatchObject({
      success: true,
      refundStatus: 'initiated',
      refundAmount: '4500',
    });

    const again = await call('refund-eligibility', base);
    expect(again.body).toMatchObject({ canRefund: false });
    expect(again.body.message).toContain('already in progress');
  });

  it('refund_order_status: explains each refusal', async () => {
    const cases: [string, string, RegExp][] = [
      ['ORD-TEST-007', 'morgan@example.test', /refund period has expired/],
      ['ORD-TEST-008', 'avery@example.test', /item was opened/],
      ['ORD-TEST-003', 'taylor@example.test', /return has not been initiated/],
    ];
    for (const [orderId, email, pattern] of cases) {
      const reply = await call('refund-eligibility', {
        order_id: orderId,
        intent: 'refund',
        email,
      });
      expect(reply.body).toMatchObject({ success: true, canRefund: false });
      expect(reply.body.message).toMatch(pattern);
      expectSpeakable(reply.body.message);
    }
  });
});

describe('POST /api/order (one URL for every function, like the n8n webhook)', () => {
  it('routes on the intent text the way the n8n switch does', async () => {
    const cases = [
      [{ order_id: 'ORD-TEST-001', intent: 'track order' }, 'track_order'],
      [{ order_id: 'ORD-TEST-001', intent: 'track_order' }, 'track_order'],
      [
        { order_id: 'ORD-TEST-001', intent: 'cancel order', email: 'alex@example.test' },
        'cancel_order',
      ],
      [
        { order_id: 'ORD-TEST-003', intent: 'return_item', email: 'taylor@example.test' },
        'return_item',
      ],
      [{ order_id: 'ORD-TEST-006', intent: 'refund', email: 'riley@example.test' }, 'refund_order'],
    ] as const;
    for (const [payload, intent] of cases) {
      const reply = await call('order', payload);
      expect(reply.status).toBe(200);
      expect(reply.body.intent).toBe(intent);
    }
  });

  it('accepts the full Retell body when "args only" is off', async () => {
    const reply = await call('order', {
      name: 'check_order',
      call: {
        call_id: 'call_demo_0001',
        agent_id: 'agent_demo',
        call_type: 'web_call',
        transcript: 'Agent: Hi\nUser: where is order ORD TEST 001',
        retell_llm_dynamic_variables: {},
      },
      args: { order_id: 'ORD-TEST-001', intent: 'track order', user_message: 'where is it' },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ success: true, status: 'shipped' });
  });
});

describe('operations', () => {
  it('answers well within a voice turn', async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      await call('track-order', { order_id: 'ORD-TEST-001', intent: 'track order' });
    }
    expect((performance.now() - started) / 20).toBeLessThan(50);
  });

  it('writes structured logs with a request ID and no personal data', () => {
    expect(logLines.length).toBeGreaterThan(10);
    for (const line of logLines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(typeof entry.request_id).toBe('string');
    }
    const all = logLines.join('\n');
    expect(all).not.toMatch(/@example\.test"/);
    expect(all).not.toContain('555-01');
    expect(all).not.toContain(API_KEY);
  });
});

describe('fail-fast configuration', () => {
  it('refuses to serve when required variables are missing', async () => {
    vi.stubEnv('RETELL_API_KEY', '');
    vi.resetModules();
    const track = (await import('../api/track-order.js')) as RouteModule;
    const health = (await import('../api/health.js')) as RouteModule;

    const response = await track.POST(
      await retellRequest('/api/track-order', { order_id: 'ORD-TEST-001' }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, error: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('RETELL_API_KEY');

    const healthResponse = await health.GET(new Request('https://lumina.example.test/api/health'));
    expect(healthResponse.status).toBe(503);
    expect(logLines.some((line) => line.includes('config_invalid'))).toBe(true);
    vi.stubEnv('RETELL_API_KEY', API_KEY);
  });

  it('refuses to serve in production with a placeholder key', async () => {
    vi.stubEnv('RETELL_API_KEY', 'replace-with-your-retell-key');
    vi.resetModules();
    const track = (await import('../api/track-order.js')) as RouteModule;
    const response = await track.POST(
      await retellRequest(
        '/api/track-order',
        { order_id: 'ORD-TEST-001' },
        { key: 'replace-with-your-retell-key' },
      ),
    );
    expect(response.status).toBe(500);
    vi.stubEnv('RETELL_API_KEY', API_KEY);
  });
});
