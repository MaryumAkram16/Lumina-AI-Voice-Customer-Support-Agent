import { z } from 'zod';

/**
 * Structural validation of what Retell sends. Unknown fields, wrong types and
 * over-long values are rejected outright (HTTP 400).
 *
 * Field names come from the Retell agent export: the seven custom functions
 * send these arguments, including the inconsistent `Phone_no` / `phone_no`.
 */

const text = (max: number) => z.string().max(max).nullish();

export const argsSchema = z.strictObject({
  order_id: text(64),
  intent: text(80),
  email: text(254),
  phone_no: text(40),
  Phone_no: text(40),
  customer_name: text(120),
  user_message: text(2000),
  reason: text(500),
  item_condition: text(120),
  date: text(60),
  // Accepted because the Retell function sends it, but never trusted: the
  // refund amount always comes from the order record.
  refund_amount: z.union([z.string().max(32), z.number()]).nullish(),
  cancellation_initiated: text(10),
  return_initiated: text(10),
  refund_initiated: text(10),
  event_id: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,100}$/)
    .nullish(),
});

/** Body when the Retell function has "Payload: args only" switched off. */
export const wrappedSchema = z.strictObject({
  name: z.string().max(100).optional(),
  call: z.record(z.string(), z.unknown()).optional(),
  args: argsSchema,
});

export interface LuminaRequest {
  /** Cleaned order ID, or null when none was given. */
  orderId: string | null;
  /** False when the order ID cannot be a real one (odd characters, too short). */
  orderIdWellFormed: boolean;
  intent: string | undefined;
  email: string | undefined;
  phone: string | undefined;
  reason: string | undefined;
  itemCondition: string | undefined;
  cancellationInitiated: string | undefined;
  returnInitiated: string | undefined;
  refundInitiated: string | undefined;
  eventId: string | undefined;
  callId: string | undefined;
}

/** What a language model sends when it has nothing to put in a required field. */
const PLACEHOLDER = /^(n\/?a|none|null|nil|undefined|unknown|not provided|not available|-+|\.+)?$/i;

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return PLACEHOLDER.test(trimmed) ? undefined : trimmed;
}

const ORDER_ID_FORMAT = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;

/** "ord test 001" -> "ORD-TEST-001": speech-to-text rarely keeps the dashes. */
export function cleanOrderId(value: string | null | undefined): string | null {
  const cleaned = clean(value);
  if (!cleaned) return null;
  return cleaned
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^#/, '');
}

export type ParseResult =
  { ok: true; request: LuminaRequest } | { ok: false; issues: { path: string; code: string }[] };

/** Validates the parsed JSON body and maps it to the internal request. */
export function parseRequestBody(body: unknown): ParseResult {
  const isWrapped =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.hasOwn(body, 'args') &&
    typeof (body as { args: unknown }).args === 'object';

  const result = isWrapped ? wrappedSchema.safeParse(body) : argsSchema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      // Paths and codes only: never echo submitted values or unknown key names.
      issues: result.error.issues.slice(0, 10).map((issue) => ({
        path: issue.code === 'unrecognized_keys' ? '(unknown field)' : issue.path.join('.'),
        code: issue.code,
      })),
    };
  }

  const args = 'args' in result.data ? result.data.args : result.data;
  const call = 'args' in result.data ? result.data.call : undefined;
  const callId = typeof call?.call_id === 'string' ? call.call_id.slice(0, 100) : undefined;
  const orderId = cleanOrderId(args.order_id);

  return {
    ok: true,
    request: {
      orderId,
      orderIdWellFormed: orderId !== null && ORDER_ID_FORMAT.test(orderId),
      intent: clean(args.intent),
      email: clean(args.email)?.toLowerCase(),
      phone: clean(args.phone_no) ?? clean(args.Phone_no),
      reason: clean(args.reason),
      itemCondition: clean(args.item_condition),
      cancellationInitiated: clean(args.cancellation_initiated),
      returnInitiated: clean(args.return_initiated),
      refundInitiated: clean(args.refund_initiated),
      eventId: clean(args.event_id),
      callId,
    },
  };
}
