import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';
import { createRepository } from '../lib/data/index.js';
import { SupabaseOrderRepository, type SupabaseOptions } from '../lib/data/supabase-repository.js';
import { DataSourceError } from '../lib/data/types.js';

const API_KEY = 'key_test_only_not_a_real_retell_key';
const OPTIONS: SupabaseOptions = {
  url: 'https://abcd1234.supabase.co',
  serviceKey: 'test_only_not_a_real_service_role_key',
  table: 'orders',
  timeoutMs: 50,
  retries: 2,
  backoffMs: 10,
};

const ROW = {
  order_id: 'ORD-TEST-005',
  customer_name: 'Casey Example',
  email: 'casey@example.test',
  phone: '+1-555-0105',
  status: 'delivered',
  carrier: 'UPS',
  tracking_number: '1ZTEST00000000005',
  delivery_date: '2026-11-14',
  delivery_location: 'Test City',
  tracking_steps: ['Label created', 'In transit', 'Delivered'],
  item: 'Wireless Headphones',
  price: 4500,
  item_condition: 'unopened',
  cancel_date: null,
  cancel_reason: null,
  return_status: null,
  return_reason: null,
  return_initiated_at: null,
  refund_status: null,
  refund_amount: null,
  refund_date: null,
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function first(calls: Call[]): Call {
  const call = calls[0];
  if (!call) throw new Error('no request was made');
  return call;
}

function fake(
  respond: (call: Call, index: number) => Response | Promise<Response>,
  options: Partial<SupabaseOptions> = {},
) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    };
    calls.push(call);
    return Promise.resolve(respond(call, calls.length - 1));
  }) as unknown as typeof fetch;
  const repo = new SupabaseOrderRepository(
    { ...OPTIONS, ...options },
    {
      fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  );
  return { repo, calls, sleeps };
}

describe('Supabase adapter', () => {
  it('looks orders up by canonical key and maps columns', async () => {
    const { repo, calls } = fake(() => Response.json([ROW]));
    const found = await repo.findByOrderId('ord test 005');
    expect(found).toMatchObject({
      orderId: 'ORD-TEST-005',
      customerName: 'Casey Example',
      deliveryDate: '2026-11-14',
      price: '4500',
      itemCondition: 'unopened',
      trackingSteps: ['Label created', 'In transit', 'Delivered'],
      refundStatus: null,
    });
    const url = new URL(first(calls).url);
    expect(url.pathname).toBe('/rest/v1/orders');
    expect(url.searchParams.get('order_key')).toBe('eq.ORDTEST005');
    expect(first(calls).headers.apikey).toBe(OPTIONS.serviceKey);
    expect(first(calls).headers.authorization).toBe(`Bearer ${OPTIONS.serviceKey}`);
  });

  it('returns null for an unknown order and never queries for an empty ID', async () => {
    const { repo, calls } = fake(() => Response.json([]));
    expect(await repo.findByOrderId('ORD-TEST-999')).toBeNull();
    expect(await repo.findByOrderId('---')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('keeps caller text out of the filter', async () => {
    const { repo, calls } = fake(() => Response.json([]));
    await repo.findByOrderId('1,order_id.neq.x&or=(a.eq.b)');
    const url = new URL(first(calls).url);
    expect(url.searchParams.get('order_key')).toBe('eq.1ORDERIDNEQXORAEQB');
    expect(url.searchParams.has('or')).toBe(false);
  });

  it('sends the newer sb_secret_ keys in apikey only', async () => {
    const { repo, calls } = fake(() => Response.json([]), {
      serviceKey: 'sb_secret_test_only_not_real',
    });
    await repo.findByOrderId('ORD-TEST-001');
    expect(first(calls).headers.apikey).toBe('sb_secret_test_only_not_real');
    expect(first(calls).headers.authorization).toBeUndefined();
  });

  it('writes only the patched columns', async () => {
    const { repo, calls } = fake(() => Response.json([{ order_id: 'ORD-TEST-004' }]));
    await repo.update('ORD-TEST-004', { status: 'cancelled', cancelReason: 'Changed my mind' });
    expect(first(calls).method).toBe('PATCH');
    expect(new URL(first(calls).url).searchParams.get('order_key')).toBe('eq.ORDTEST004');
    expect(JSON.parse(String(first(calls).body))).toEqual({
      status: 'cancelled',
      cancel_reason: 'Changed my mind',
    });
    expect(first(calls).headers.prefer).toBe('return=representation');
  });

  it('reports an update that matched no row', async () => {
    const { repo } = fake(() => Response.json([]));
    await expect(repo.update('ORD-TEST-404', { status: 'x' })).rejects.toMatchObject({
      category: 'not_found',
    });
  });

  it('retries server errors with backoff, then gives up', async () => {
    const { repo, calls, sleeps } = fake(() => new Response('busy', { status: 503 }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toMatchObject({
      category: 'unavailable',
    });
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry a rejected key', async () => {
    const { repo, calls } = fake(() => new Response('no', { status: 401 }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toMatchObject({
      category: 'unauthorized',
    });
    expect(calls).toHaveLength(1);
  });

  it('treats a non-list body as a schema problem', async () => {
    const { repo } = fake(() => Response.json({ message: 'odd' }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toBeInstanceOf(DataSourceError);
  });
});

describe('Supabase configuration', () => {
  const problems = (env: Record<string, string>) => {
    try {
      loadConfig(env);
      return [];
    } catch (error) {
      return (error as { problems: string[] }).problems;
    }
  };

  it('requires the URL and the server-side key', () => {
    const found = problems({ RETELL_API_KEY: API_KEY, DATA_SOURCE: 'supabase' });
    expect(found).toContain('SUPABASE_URL is required for DATA_SOURCE=supabase');
    expect(found).toContain('SUPABASE_SERVICE_ROLE_KEY is required for DATA_SOURCE=supabase');
  });

  it('rejects the publishable key and a non-https URL', () => {
    const found = problems({
      RETELL_API_KEY: API_KEY,
      DATA_SOURCE: 'supabase',
      SUPABASE_URL: 'http://abcd.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test_only_not_real',
    });
    expect(found.join(' ')).toMatch(/SUPABASE_URL must be/);
    expect(found.join(' ')).toMatch(/not the publishable key/);
  });

  it('builds the Supabase adapter with defaults', () => {
    const config = loadConfig({
      RETELL_API_KEY: API_KEY,
      DATA_SOURCE: 'supabase',
      SUPABASE_URL: 'https://abcd1234.supabase.co/',
      SUPABASE_SECRET_KEY: 'sb_secret_test_only_not_real',
    });
    expect(config.supabase).toMatchObject({
      url: 'https://abcd1234.supabase.co',
      table: 'orders',
      timeoutMs: 2000,
      retries: 1,
    });
    expect(createRepository(config).name).toBe('supabase');
  });
});
