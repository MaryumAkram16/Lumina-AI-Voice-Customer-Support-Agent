import {
  canonicalOrderId,
  DataSourceError,
  type OrderPatch,
  type OrderRecord,
  type OrderRepository,
} from './types.js';

type Fetch = typeof fetch;

export interface SupabaseOptions {
  /** Project URL, e.g. https://abcd1234.supabase.co (no trailing slash). */
  url: string;
  /** Server-side key: the service_role key or a `sb_secret_...` key. Never shipped to a browser. */
  serviceKey: string;
  /** Table holding the orders (see supabase/schema.sql). */
  table: string;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Extra attempts after the first one. */
  retries: number;
  /** First backoff delay; doubles on each retry. */
  backoffMs: number;
}

interface Dependencies {
  fetchImpl: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Column names in supabase/schema.sql, keyed by `OrderRecord` field. */
const COLUMNS: Record<keyof OrderRecord, string> = {
  orderId: 'order_id',
  customerName: 'customer_name',
  email: 'email',
  phone: 'phone',
  status: 'status',
  carrier: 'carrier',
  trackingNumber: 'tracking_number',
  deliveryDate: 'delivery_date',
  deliveryLocation: 'delivery_location',
  trackingSteps: 'tracking_steps',
  item: 'item',
  price: 'price',
  itemCondition: 'item_condition',
  cancelDate: 'cancel_date',
  cancelReason: 'cancel_reason',
  returnStatus: 'return_status',
  returnReason: 'return_reason',
  returnInitiatedAt: 'return_initiated_at',
  refundStatus: 'refund_status',
  refundAmount: 'refund_amount',
  refundDate: 'refund_date',
};

const SELECT = Object.values(COLUMNS).join(',');

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== '—' ? trimmed : null;
}

function steps(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter((s): s is string => s !== null);
  const raw = text(value);
  return raw
    ? raw
        .split(/[;\n|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/**
 * Supabase adapter. Talks to the project's REST API (PostgREST) with plain
 * fetch, so it adds no dependency. Orders are matched on the `order_key`
 * column, which the database derives from `order_id` the same way
 * `canonicalOrderId` does, so "ord test 001" finds "ORD-TEST-001".
 */
export class SupabaseOrderRepository implements OrderRepository {
  readonly name = 'supabase' as const;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly endpoint: string;

  constructor(
    private readonly options: SupabaseOptions,
    private readonly deps: Dependencies,
  ) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.endpoint = `${options.url.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(options.table)}`;
  }

  async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const key = canonicalOrderId(orderId);
    if (!key) return null;
    // `key` is letters and digits only, so it cannot change the filter's meaning.
    const response = await this.request(
      `${this.endpoint}?select=${SELECT}&order_key=eq.${encodeURIComponent(key)}&limit=1`,
      { method: 'GET' },
    );
    const rows = await this.json(response);
    const row = rows[0];
    return row ? this.toRecord(row) : null;
  }

  async update(orderId: string, patch: OrderPatch): Promise<void> {
    const body: Record<string, string | null> = {};
    for (const [field, value] of Object.entries(patch) as [keyof OrderPatch, string | null][]) {
      body[COLUMNS[field]] = value ?? null;
    }
    if (Object.keys(body).length === 0) return;

    const key = canonicalOrderId(orderId);
    const response = await this.request(
      `${this.endpoint}?order_key=eq.${encodeURIComponent(key)}&select=order_id`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        prefer: 'return=representation',
      },
    );
    const rows = await this.json(response);
    if (rows.length === 0) {
      throw new DataSourceError('not_found', 'Order row disappeared before the update');
    }
  }

  private toRecord(row: Record<string, unknown>): OrderRecord {
    const get = (field: keyof OrderRecord) => text(row[COLUMNS[field]]);
    return {
      orderId: get('orderId') ?? '',
      customerName: get('customerName'),
      email: get('email'),
      phone: get('phone'),
      status: get('status'),
      carrier: get('carrier'),
      trackingNumber: get('trackingNumber'),
      deliveryDate: get('deliveryDate'),
      deliveryLocation: get('deliveryLocation'),
      trackingSteps: steps(row[COLUMNS.trackingSteps]),
      item: get('item'),
      price: get('price'),
      itemCondition: get('itemCondition'),
      cancelDate: get('cancelDate'),
      cancelReason: get('cancelReason'),
      returnStatus: get('returnStatus'),
      returnReason: get('returnReason'),
      returnInitiatedAt: get('returnInitiatedAt'),
      refundStatus: get('refundStatus'),
      refundAmount: get('refundAmount'),
      refundDate: get('refundDate'),
    };
  }

  private async json(response: Response): Promise<Record<string, unknown>[]> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new DataSourceError('schema', 'Supabase returned a body that is not JSON');
    }
    if (!Array.isArray(body)) throw new DataSourceError('schema', 'Supabase returned no row list');
    return body as Record<string, unknown>[];
  }

  private headers(prefer?: string): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.options.serviceKey,
      accept: 'application/json',
      'content-type': 'application/json',
    };
    // Legacy service_role keys are JWTs and go in Authorization too. The newer
    // `sb_secret_...` keys are not JWTs and are sent in `apikey` only.
    if (!this.options.serviceKey.startsWith('sb_')) {
      headers.authorization = `Bearer ${this.options.serviceKey}`;
    }
    if (prefer) headers.prefer = prefer;
    return headers;
  }

  /** One REST call with a per-attempt timeout and retry with backoff. */
  private async request(
    url: string,
    init: { method: string; body?: string; prefer?: string },
  ): Promise<Response> {
    const attempts = this.options.retries + 1;
    let lastError = new DataSourceError('unavailable', 'Supabase request failed');

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const jitter = Math.random() * this.options.backoffMs * 0.25;
        await this.sleep(this.options.backoffMs * 2 ** (attempt - 1) + jitter);
      }
      let fatal: DataSourceError | null = null;
      try {
        const response = await this.deps.fetchImpl(url, {
          method: init.method,
          headers: this.headers(init.prefer),
          ...(init.body === undefined ? {} : { body: init.body }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (response.ok) return response;

        if (response.status === 429 || response.status >= 500) {
          lastError = new DataSourceError(
            'unavailable',
            `Supabase responded with status ${response.status}`,
          );
        } else if (response.status === 401 || response.status === 403) {
          fatal = new DataSourceError(
            'unauthorized',
            `Supabase responded with status ${response.status}`,
          );
        } else {
          // 400 (unknown column), 404 (unknown table): retrying cannot help.
          fatal = new DataSourceError(
            response.status === 404 ? 'not_found' : 'schema',
            `Supabase responded with status ${response.status}`,
          );
        }
      } catch (error) {
        lastError =
          error instanceof DataSourceError
            ? error
            : new DataSourceError('timeout', 'Supabase request timed out or failed');
      }
      if (fatal) throw fatal;
    }
    throw lastError;
  }
}
