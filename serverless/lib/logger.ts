import { maskEmail, maskName, maskOrderId, maskPhone } from './sanitize.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  child(bound: LogFields): Logger;
}

const MASKERS: Record<string, (value: string) => string> = {
  email: maskEmail,
  phone: maskPhone,
  phone_no: maskPhone,
  Phone_no: maskPhone,
  customer_name: maskName,
  order_id: maskOrderId,
};

/** Free text from the caller is never logged, only its length. */
const LENGTH_ONLY = new Set(['user_message', 'reason', 'item_condition', 'date', 'refund_amount']);

/** Masks personal data by field name, at any depth. */
export function redact(value: unknown, key = '', depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') {
    if (LENGTH_ONLY.has(key)) return `[${value.length} chars]`;
    const mask = MASKERS[key];
    return mask ? mask(value) : value.slice(0, 300);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]));
  }
  return value;
}

/** One JSON object per line: what Vercel's log viewer and drains expect. */
export function createLogger(
  write: (line: string) => void = (line) => {
    console.log(line);
  },
  bound: LogFields = {},
): Logger {
  return {
    log(level, event, fields = {}) {
      const entry = redact({ ...bound, ...fields }) as LogFields;
      write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...entry }));
    },
    child(extra) {
      return createLogger(write, { ...bound, ...extra });
    },
  };
}
