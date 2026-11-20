import { loadConfig, type AppConfig } from '../lib/config.js';
import { DemoOrderRepository } from '../lib/data/demo-repository.js';
import type { OrderRecord, OrderRepository } from '../lib/data/types.js';
import { createApp, type App, type Route } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { calendarDay, type RuleContext } from '../lib/rules.js';
import { signRetellBody } from '../lib/signature.js';
import type { OpenMonitorSocket } from '../lib/transcript.js';

/** Obviously fake. Only ever used to sign requests inside the test process. */
export const API_KEY = 'key_test_only_not_a_real_retell_key';

/** The clock every test runs on: Sunday 15 November 2026, midday UTC. */
export const NOW = new Date('2026-11-15T12:00:00.000Z');
export const TODAY = calendarDay(2026, 11, 15);
export const CTX: RuleContext = { today: TODAY, nowIso: NOW.toISOString(), currency: 'PKR' };

export function isoDaysFromToday(offset: number): string {
  return new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

export function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: 'ORD-UNIT-001',
    customerName: 'Unit Example',
    email: 'unit@example.test',
    phone: '+1-555-0199',
    status: 'processing',
    carrier: 'UPS',
    trackingNumber: '1ZTESTUNIT',
    deliveryDate: isoDaysFromToday(3),
    deliveryLocation: 'Test City',
    trackingSteps: ['Order received'],
    item: 'Test Item',
    price: '1000',
    itemCondition: null,
    cancelDate: null,
    cancelReason: null,
    returnStatus: null,
    returnReason: null,
    returnInitiatedAt: null,
    refundStatus: null,
    refundAmount: null,
    refundDate: null,
    ...overrides,
  };
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({ RETELL_API_KEY: API_KEY, ...env });
}

export interface TestApp {
  app: App;
  logs: string[];
  repository: OrderRepository;
}

export function makeApp(
  options: {
    env?: Record<string, string>;
    repository?: OrderRepository;
    createWebCall?: (agentId: string) => Promise<Record<string, unknown>>;
    openMonitorSocket?: OpenMonitorSocket;
    transcriptStreamMs?: number;
  } = {},
): TestApp {
  const logs: string[] = [];
  const repository = options.repository ?? new DemoOrderRepository(undefined, () => NOW);
  const app = createApp({
    config: testConfig(options.env),
    repository,
    logger: createLogger((line) => logs.push(line)),
    now: () => NOW,
    ...(options.createWebCall ? { createWebCall: options.createWebCall } : {}),
    ...(options.openMonitorSocket ? { openMonitorSocket: options.openMonitorSocket } : {}),
    ...(options.transcriptStreamMs ? { transcriptStreamMs: options.transcriptStreamMs } : {}),
  });
  return { app, logs, repository };
}

export interface RequestOptions {
  method?: string;
  /** Raw body to send instead of JSON.stringify(payload). */
  raw?: string;
  /** false = no signature header; a string = use that header value. */
  signature?: string | false;
  headers?: Record<string, string>;
  key?: string;
}

/** Builds a request the way Retell sends a custom-function call. */
export async function retellRequest(
  path: string,
  payload: unknown,
  options: RequestOptions = {},
): Promise<Request> {
  const method = options.method ?? 'POST';
  const raw = options.raw ?? JSON.stringify(payload);
  const headers = new Headers({ 'content-type': 'application/json', 'x-real-ip': '203.0.113.10' });
  if (options.signature === undefined) {
    headers.set('x-retell-signature', await signRetellBody(raw, options.key ?? API_KEY));
  } else if (options.signature !== false) {
    headers.set('x-retell-signature', options.signature);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(`https://lumina.example.test${path}`, {
    method,
    headers,
    ...(hasBody ? { body: raw } : {}),
  });
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
  text: string;
  headers: Headers;
}

const PATHS: Record<Route, string> = {
  track_order: '/api/track-order',
  cancel_order: '/api/cancel-order',
  return_item: '/api/return-item',
  refund_order: '/api/refund-eligibility',
  order: '/api/order',
};

export async function send(
  app: App,
  route: Route,
  payload: unknown,
  options: RequestOptions = {},
): Promise<Reply> {
  const response = await app.handle(route, await retellRequest(PATHS[route], payload, options));
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Left empty: tests that care assert on `text`.
  }
  return { status: response.status, body, text, headers: response.headers };
}

/** A voice agent must be able to read the message aloud as-is. */
export function expectSpeakable(message: unknown): void {
  if (typeof message !== 'string') throw new Error('message is not a string');
  if (message.length === 0 || message.length > 320) throw new Error(`bad length: ${message}`);
  if (/[*_#`|<>{}[\]\\\n\r\t]/.test(message)) throw new Error(`markup in message: ${message}`);
  if (/\p{Extended_Pictographic}/u.test(message)) throw new Error(`emoji in message: ${message}`);
  if (/https?:\/\//i.test(message)) throw new Error(`URL in message: ${message}`);
  // No order IDs or tracking numbers, which a voice would read digit by digit.
  if (/ORD-|\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]*\d{5,}[A-Z0-9]*\b|\d{7,}/.test(message)) {
    throw new Error(`ID in message: ${message}`);
  }
}

/** URL of a `fetch` call as text, whatever form the first argument took. */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
