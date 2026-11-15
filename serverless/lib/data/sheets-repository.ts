import { guardFormula } from '../sanitize.js';
import type { GoogleTokenProvider } from './google-auth.js';
import {
  canonicalOrderId,
  DataSourceError,
  type OrderPatch,
  type OrderRecord,
  type OrderRepository,
} from './types.js';

type Fetch = typeof fetch;

export interface SheetsOptions {
  sheetId: string;
  tab: string;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Extra attempts after the first one. */
  retries: number;
  /** First backoff delay; doubles on each retry. */
  backoffMs: number;
  /** How long a full read of the tab may be reused. 0 disables the cache. */
  cacheTtlMs: number;
}

interface Dependencies {
  fetchImpl: Fetch;
  tokens: Pick<GoogleTokenProvider, 'getToken' | 'invalidate'>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type Field = keyof OrderRecord;

/**
 * Sheet columns are found by header name, not position. Headers are compared
 * lower-cased with spaces and punctuation removed, so "Order ID", "OrderID"
 * and "order_id" are the same column. Names follow the n8n workflow's sheets.
 */
const COLUMN_ALIASES: Record<Field, readonly string[]> = {
  orderId: ['orderid'],
  customerName: ['customername', 'name'],
  email: ['email'],
  phone: ['phoneno', 'phone', 'phonenumber'],
  status: ['status'],
  carrier: ['carrier'],
  trackingNumber: ['trackingnumber', 'trackingno'],
  deliveryDate: ['delivery', 'deliverydate'],
  deliveryLocation: ['deliverylocation'],
  trackingSteps: ['trackingsteps'],
  item: ['item'],
  price: ['price'],
  itemCondition: ['itemcondition'],
  cancelDate: ['canceldate', 'cancelleddate'],
  cancelReason: ['reason', 'cancelreason'],
  returnStatus: ['returnstatus'],
  returnReason: ['returnreason'],
  returnInitiatedAt: ['returninitiate', 'returninitiated'],
  refundStatus: ['refundstatus'],
  refundAmount: ['refundamount'],
  refundDate: ['refunddate'],
};

interface Snapshot {
  fetchedAt: number;
  columns: Map<Field, number>;
  rows: Map<string, { record: OrderRecord; rowNumber: number }>;
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Google Sheets adapter: one tab, one row per order. */
export class SheetsOrderRepository implements OrderRepository {
  readonly name = 'sheets' as const;
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly options: SheetsOptions,
    private readonly deps: Dependencies,
  ) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    // The lookup is a Map read on the canonical ID. Caller text is never put
    // into a query, filter or formula, so there is nothing to inject into.
    const snapshot = await this.load();
    const hit = snapshot.rows.get(canonicalOrderId(orderId));
    return hit ? { ...hit.record, trackingSteps: [...hit.record.trackingSteps] } : null;
  }

  async update(orderId: string, patch: OrderPatch): Promise<void> {
    const snapshot = await this.load();
    const hit = snapshot.rows.get(canonicalOrderId(orderId));
    if (!hit) throw new DataSourceError('not_found', 'Order row disappeared before the update');

    const data: { range: string; values: string[][] }[] = [];
    for (const [field, value] of Object.entries(patch) as [keyof OrderPatch, string | null][]) {
      const column = snapshot.columns.get(field);
      if (column === undefined) {
        throw new DataSourceError('schema', `Sheet has no column for "${field}"`);
      }
      data.push({
        range: `${this.quotedTab()}!${columnLetter(column)}${hit.rowNumber}`,
        values: [[guardFormula(value ?? '')]],
      });
    }
    if (data.length === 0) return;

    await this.request(`${API}/${this.options.sheetId}/values:batchUpdate`, {
      method: 'POST',
      // RAW: Sheets stores the text as typed and never evaluates it.
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    Object.assign(hit.record, patch);
  }

  private quotedTab(): string {
    return `'${this.options.tab.replace(/'/g, "''")}'`;
  }

  private async load(): Promise<Snapshot> {
    const fresh =
      this.snapshot && this.now() - this.snapshot.fetchedAt < this.options.cacheTtlMs
        ? this.snapshot
        : null;
    if (fresh) return fresh;
    // Concurrent requests share one read instead of each hitting the API.
    this.loading ??= this.fetchSnapshot().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async fetchSnapshot(): Promise<Snapshot> {
    const range = encodeURIComponent(`${this.quotedTab()}!A1:AZ`);
    const response = await this.request(
      `${API}/${this.options.sheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
      { method: 'GET' },
    );
    const body = (await response.json()) as { values?: unknown };
    const values = Array.isArray(body.values) ? (body.values as unknown[][]) : [];
    const [header = [], ...rows] = values;

    const columns = new Map<Field, number>();
    header.forEach((cell, index) => {
      const name = normalizeHeader(String(cell));
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [Field, string[]][]) {
        if (aliases.includes(name) && !columns.has(field)) columns.set(field, index);
      }
    });
    if (!columns.has('orderId')) {
      throw new DataSourceError('schema', 'Sheet has no OrderID column');
    }

    const cell = (row: unknown[], field: Field): string | null => {
      const index = columns.get(field);
      const value = index === undefined ? undefined : row[index];
      const text = typeof value === 'string' ? value.trim() : '';
      return text && text !== '—' ? text : null;
    };

    const byId = new Map<string, { record: OrderRecord; rowNumber: number }>();
    rows.forEach((row, index) => {
      const orderId = cell(row, 'orderId');
      const key = orderId ? canonicalOrderId(orderId) : '';
      if (!orderId || !key || byId.has(key)) return;
      const steps = cell(row, 'trackingSteps');
      byId.set(key, {
        rowNumber: index + 2, // +1 for the header row, +1 because rows are 1-based.
        record: {
          orderId,
          customerName: cell(row, 'customerName'),
          email: cell(row, 'email'),
          phone: cell(row, 'phone'),
          status: cell(row, 'status'),
          carrier: cell(row, 'carrier'),
          trackingNumber: cell(row, 'trackingNumber'),
          deliveryDate: cell(row, 'deliveryDate'),
          deliveryLocation: cell(row, 'deliveryLocation'),
          trackingSteps: steps
            ? steps
                .split(/[;\n|]/)
                .map((step) => step.trim())
                .filter(Boolean)
            : [],
          item: cell(row, 'item'),
          price: cell(row, 'price'),
          itemCondition: cell(row, 'itemCondition'),
          cancelDate: cell(row, 'cancelDate'),
          cancelReason: cell(row, 'cancelReason'),
          returnStatus: cell(row, 'returnStatus'),
          returnReason: cell(row, 'returnReason'),
          returnInitiatedAt: cell(row, 'returnInitiatedAt'),
          refundStatus: cell(row, 'refundStatus'),
          refundAmount: cell(row, 'refundAmount'),
          refundDate: cell(row, 'refundDate'),
        },
      });
    });

    this.snapshot = { fetchedAt: this.now(), columns, rows: byId };
    return this.snapshot;
  }

  /** One Sheets API call with a per-attempt timeout and retry with backoff. */
  private async request(url: string, init: { method: string; body?: string }): Promise<Response> {
    const attempts = this.options.retries + 1;
    let lastError = new DataSourceError('unavailable', 'Google Sheets request failed');

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const jitter = Math.random() * this.options.backoffMs * 0.25;
        await this.sleep(this.options.backoffMs * 2 ** (attempt - 1) + jitter);
      }
      let fatal: DataSourceError | null = null;
      try {
        const token = await this.deps.tokens.getToken();
        const response = await this.deps.fetchImpl(url, {
          method: init.method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(init.body === undefined ? {} : { body: init.body }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (response.ok) return response;

        if (response.status === 401) {
          this.deps.tokens.invalidate();
          lastError = new DataSourceError('unauthorized', 'Google Sheets rejected the token');
        } else if (response.status === 429 || response.status >= 500) {
          lastError = new DataSourceError(
            'unavailable',
            `Google Sheets responded with status ${response.status}`,
          );
        } else {
          // 400, 403, 404: retrying cannot help.
          fatal = new DataSourceError(
            response.status === 404 ? 'not_found' : 'unauthorized',
            `Google Sheets responded with status ${response.status}`,
          );
        }
      } catch (error) {
        lastError =
          error instanceof DataSourceError
            ? error
            : new DataSourceError('timeout', 'Google Sheets request timed out or failed');
      }
      if (fatal) throw fatal;
    }
    throw lastError;
  }
}
