/**
 * Lumina business rules.
 *
 * Pure functions only: no network, no clock, no environment. Every route goes
 * through this module, so the rules stay identical across endpoints. The rules
 * are ported from the Code nodes of the n8n workflow
 * (`Lumina_AI_Voice_Customer_Support_Agent..json`); the node each rule comes
 * from is named next to it. Anything stricter than n8n is marked "Hardening".
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { OrderRecord } from './data/types.js';
import { phoneDigits, speakable } from './sanitize.js';

/** n8n "Evaluate Return Eligibility Policy": RETURN_POLICY_DAYS. */
export const RETURN_POLICY_DAYS = 14;
/** n8n "Evaluate Refund Eligibility Policy": REFUND_POLICY_DAYS. */
export const REFUND_POLICY_DAYS = 14;

export type Intent = 'track_order' | 'cancel_order' | 'return_item' | 'refund_order';

/** Outcome categories from OPERATIONS.md, section 4. */
export type Outcome =
  | 'success'
  | 'not_found'
  | 'validation_error'
  | 'verification_required'
  | 'not_eligible'
  | 'duplicate';

export interface RuleContext {
  /** Today as a calendar-day number (see `calendarDay`). */
  today: number;
  /** Timestamp recorded on state changes, ISO 8601. */
  nowIso: string;
  /** Spoken after refund amounts. n8n hardcodes "PKR". */
  currency: string;
}

export interface LuminaResponse {
  success: boolean;
  outcome: Outcome;
  intent: Intent;
  /** Short, speakable sentence(s) for the voice agent. */
  message: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Intent routing (n8n "Route by User Intent": `contains`, first match wins)
// ---------------------------------------------------------------------------

export function resolveIntent(raw: string | undefined): Intent | null {
  if (!raw) return null;
  const text = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.includes('track') || text.includes('order status') || text.includes('check order')) {
    return 'track_order';
  }
  if (text.includes('cancel')) return 'cancel_order';
  if (text.includes('return')) return 'return_item';
  if (text.includes('refund')) return 'refund_order';
  return null;
}

/** n8n IF nodes compare `*_initiated` to the exact string "yes". */
export function isInitiated(flag: string | undefined): boolean {
  return flag?.trim().toLowerCase() === 'yes';
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Calendar date as whole days since 1970-01-01. */
export function calendarDay(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Today's calendar day in the business time zone. */
export function todayIn(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return calendarDay(get('year'), get('month'), get('day'));
}

export type ParsedDate =
  { kind: 'ok'; day: number; iso: string } | { kind: 'missing' } | { kind: 'invalid' };

/**
 * n8n parses the sheet's delivery date as DD-MM-YY ("Parse deliveryDate
 * (DD-MM-YY)"). ISO YYYY-MM-DD is accepted as well because SETUP.md and
 * demo/orders.json use it. Anything else is `invalid`, which n8n reports as
 * "Delivery date format is invalid".
 */
export function parseDeliveryDate(raw: string | null | undefined): ParsedDate {
  const text = raw?.trim() ?? '';
  if (!text) return { kind: 'missing' };

  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(text);
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(text);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (year < 100) year += 2000;
  } else {
    return { kind: 'invalid' };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!real) return { kind: 'invalid' };
  return { kind: 'ok', day: calendarDay(year, month, day), iso: date.toISOString().slice(0, 10) };
}

/** "31 December 2026": reads naturally when spoken. */
export function spokenDate(day: number): string {
  return new Date(day * DAY_MS).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function spokenTimestamp(iso: string | null, fallbackDay: number): string {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return spokenDate(Number.isNaN(parsed) ? fallbackDay : Math.floor(parsed / DAY_MS));
}

// ---------------------------------------------------------------------------
// Status handling
// ---------------------------------------------------------------------------

export function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isCancelled(order: OrderRecord): boolean {
  return /^cancel(l)?ed$/.test(normalizeStatus(order.status));
}

export function isDelivered(order: OrderRecord): boolean {
  return normalizeStatus(order.status) === 'delivered';
}

const IN_PROGRESS_STATUSES = new Set([
  'pending',
  'processing',
  'confirmed',
  'packed',
  'label created',
  'shipped',
  'in transit',
  'out for delivery',
]);

function isStillOnItsWay(order: OrderRecord): boolean {
  return IN_PROGRESS_STATUSES.has(normalizeStatus(order.status));
}

// ---------------------------------------------------------------------------
// Customer verification
// ---------------------------------------------------------------------------

export interface Identity {
  email?: string | undefined;
  phone?: string | undefined;
}

export type Verification = 'verified' | 'mismatch' | 'not_provided';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time string comparison (hash first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function phonesMatch(supplied: string, onFile: string): boolean {
  const a = phoneDigits(supplied);
  const b = phoneDigits(onFile);
  if (a.length < 7 || b.length < 7) return false;
  if (safeEqual(a, b)) return true;
  // Tolerate a missing or extra country code: compare the last 10 digits.
  const tail = 10;
  return a.length >= tail && b.length >= tail && safeEqual(a.slice(-tail), b.slice(-tail));
}

/**
 * The caller is verified when the email or the phone number they gave matches
 * the order. `order` may be null so that the same amount of work is done for a
 * missing order as for a wrong contact detail (no order enumeration by timing).
 */
export function verifyIdentity(order: OrderRecord | null, identity: Identity): Verification {
  const email = identity.email?.trim().toLowerCase() ?? '';
  const phone = identity.phone?.trim() ?? '';
  if (!email && !phone) return 'not_provided';

  const emailOnFile = order?.email?.trim().toLowerCase() ?? '';
  const phoneOnFile = order?.phone ?? '';
  const emailOk = safeEqual(email, emailOnFile) && email !== '' && emailOnFile !== '';
  const phoneOk = phonesMatch(phone, phoneOnFile);
  return emailOk || phoneOk ? 'verified' : 'mismatch';
}

// ---------------------------------------------------------------------------
// Shared responses
// ---------------------------------------------------------------------------

/**
 * One message for "no such order" and "contact details do not match", so a
 * caller cannot tell which order numbers exist.
 */
export const NOT_FOUND_MESSAGE =
  "I couldn't find an order matching those details. Could you repeat the order number, and the email or phone number on the order?";

export function notFound(intent: Intent): LuminaResponse {
  const response: LuminaResponse = {
    success: false,
    outcome: 'not_found',
    intent,
    message: NOT_FOUND_MESSAGE,
    orderFound: false,
  };
  return withIntentAliases(response);
}

/** n8n "Build Order Tracking Response": missing order ID. */
export function missingOrderId(intent: Intent): LuminaResponse {
  return withIntentAliases({
    success: false,
    outcome: 'validation_error',
    intent,
    message: "I'm sorry, I didn't get the order number. Could you say it again?",
  });
}

/** Asked before any lookup, so it says nothing about whether the order exists. */
export function verificationRequired(intent: Intent): LuminaResponse {
  return withIntentAliases({
    success: false,
    outcome: 'verification_required',
    intent,
    message:
      'To protect your account, I need the email address or phone number on the order. What is it?',
  });
}

/**
 * The Retell flow prompts read `cancelMessage` (cancel) and `return message`
 * (return) from the n8n response, so those keys always mirror `message`.
 */
function withIntentAliases(response: LuminaResponse): LuminaResponse {
  if (response.intent === 'cancel_order') {
    response.cancelMessage = response.message;
  } else if (response.intent === 'return_item') {
    response.returnMessage = response.message;
    response['return message'] = response.message;
  }
  return response;
}

// ---------------------------------------------------------------------------
// Track order (n8n "Build Order Tracking Response")
// ---------------------------------------------------------------------------

export function trackOrder(
  order: OrderRecord,
  verified: boolean,
  ctx: RuleContext,
): LuminaResponse {
  const status = normalizeStatus(order.status);
  const delivery = parseDeliveryDate(order.deliveryDate);
  const carrier = speakable(order.carrier);
  const spokenStatus = speakable(status) || 'being processed';

  const sentences: string[] = [];
  // Hardening: the customer's name and address are only shared with a caller
  // who proved who they are. n8n shares them with anyone who has the order ID.
  const name = verified ? speakable(order.customerName, 40) : '';
  const greeting = name ? `Hi ${name}. ` : '';

  if (isCancelled(order)) {
    sentences.push(`${greeting}Your order has been cancelled.`);
  } else if (isDelivered(order)) {
    sentences.push(
      delivery.kind === 'ok'
        ? `${greeting}Your order was delivered on ${spokenDate(delivery.day)}.`
        : `${greeting}Your order has been delivered.`,
    );
  } else {
    sentences.push(
      `${greeting}Your order is currently ${spokenStatus}${carrier ? ` with ${carrier}` : ''}.`,
    );
    if (delivery.kind === 'ok') {
      const tense = delivery.day < ctx.today ? 'was expected' : 'is expected';
      sentences.push(`It ${tense} on ${spokenDate(delivery.day)}.`);
    } else {
      sentences.push("It doesn't have a delivery date yet.");
    }
    const latest = speakable(order.trackingSteps.at(-1));
    if (latest) sentences.push(`The latest update is: ${latest.toLowerCase()}.`);
  }

  const response: LuminaResponse = {
    success: true,
    outcome: 'success',
    intent: 'track_order',
    message: sentences.join(' '),
    // README "API Reference" response fields.
    status: status || null,
    tracking_number: order.trackingNumber ? speakable(order.trackingNumber, 40) : null,
    carrier: carrier || null,
    delivery_date: delivery.kind === 'ok' ? delivery.iso : null,
  };
  if (verified) {
    response.customer_name = name || null;
    response.delivery_location = speakable(order.deliveryLocation) || null;
    response.tracking_steps = order.trackingSteps.map((step) => speakable(step)).filter(Boolean);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Cancel order (n8n "Check Cancellation Eligibility")
// ---------------------------------------------------------------------------

export type CancelDecision =
  | { canCancel: true; code: 'eligible_today' | 'eligible_before'; deliveryIso: string }
  | {
      canCancel: false;
      code: 'already_cancelled' | 'delivered' | 'date_missing' | 'date_invalid' | 'window_passed';
    };

/** Rule: an order can be cancelled on or before its delivery date. */
export function evaluateCancellation(order: OrderRecord, ctx: RuleContext): CancelDecision {
  // Hardening (status handling): n8n looks at the date only.
  if (isCancelled(order)) return { canCancel: false, code: 'already_cancelled' };
  if (isDelivered(order)) return { canCancel: false, code: 'delivered' };

  const delivery = parseDeliveryDate(order.deliveryDate);
  if (delivery.kind === 'missing') return { canCancel: false, code: 'date_missing' };
  if (delivery.kind === 'invalid') return { canCancel: false, code: 'date_invalid' };

  if (ctx.today === delivery.day) {
    return { canCancel: true, code: 'eligible_today', deliveryIso: delivery.iso };
  }
  if (ctx.today < delivery.day) {
    return { canCancel: true, code: 'eligible_before', deliveryIso: delivery.iso };
  }
  return { canCancel: false, code: 'window_passed' };
}

/** Wording is n8n's `cancelMessage`, which the Retell prompt reads aloud. */
const CANCEL_MESSAGES: Record<CancelDecision['code'], string> = {
  eligible_today: 'Order can be cancelled today.',
  eligible_before: 'Order can be cancelled before the delivery date.',
  window_passed: 'Order cannot be cancelled. Cancellation period has passed.',
  date_missing: 'Delivery date is missing. Cannot cancel order.',
  date_invalid: 'Delivery date format is invalid. Cannot cancel order.',
  delivered: 'Order cannot be cancelled. It has already been delivered.',
  already_cancelled: 'This order has already been cancelled.',
};

export function cancellationStatus(order: OrderRecord, ctx: RuleContext): LuminaResponse {
  const decision = evaluateCancellation(order, ctx);
  return withIntentAliases({
    success: true,
    outcome: decision.canCancel ? 'success' : 'not_eligible',
    intent: 'cancel_order',
    message: CANCEL_MESSAGES[decision.code],
    orderFound: true,
    canCancel: decision.canCancel,
    status: normalizeStatus(order.status) || null,
    deliveryDate: decision.canCancel ? decision.deliveryIso : null,
  });
}

/** n8n "Build Cancellation Confirmation Message". */
export function cancellationConfirmation(
  cancelDate: string | null,
  ctx: RuleContext,
): LuminaResponse {
  return withIntentAliases({
    success: true,
    outcome: 'success',
    intent: 'cancel_order',
    message: `Your order was cancelled on ${spokenTimestamp(cancelDate, ctx.today)}. If this wasn't on purpose or you need help, we're always here.`,
    orderFound: true,
    canCancel: false,
    status: 'cancelled',
  });
}

// ---------------------------------------------------------------------------
// Return item (n8n "Evaluate Return Eligibility Policy")
// ---------------------------------------------------------------------------

export type ReturnDecision =
  | { canReturn: true; code: 'eligible'; daysSinceDelivery: number }
  | {
      canReturn: false;
      code:
        | 'cancelled'
        | 'date_missing'
        | 'date_invalid'
        | 'not_delivered'
        | 'already_initiated'
        | 'expired';
      daysSinceDelivery?: number;
    };

export function isReturnInitiated(order: OrderRecord): boolean {
  return normalizeStatus(order.returnStatus) === 'initiated';
}

/** Rule: a return is allowed up to and including 14 days after delivery. */
export function evaluateReturn(order: OrderRecord, ctx: RuleContext): ReturnDecision {
  // Hardening (status handling): n8n would call a cancelled or undelivered
  // order "eligible" because it only subtracts dates.
  if (isCancelled(order)) return { canReturn: false, code: 'cancelled' };

  const delivery = parseDeliveryDate(order.deliveryDate);
  if (delivery.kind === 'missing') return { canReturn: false, code: 'date_missing' };
  if (delivery.kind === 'invalid') return { canReturn: false, code: 'date_invalid' };

  const daysSinceDelivery = ctx.today - delivery.day;
  if (daysSinceDelivery < 0 || isStillOnItsWay(order)) {
    return { canReturn: false, code: 'not_delivered', daysSinceDelivery };
  }
  if (isReturnInitiated(order)) {
    return { canReturn: false, code: 'already_initiated', daysSinceDelivery };
  }
  return daysSinceDelivery <= RETURN_POLICY_DAYS
    ? { canReturn: true, code: 'eligible', daysSinceDelivery }
    : { canReturn: false, code: 'expired', daysSinceDelivery };
}

/** "eligible", "expired" and "date_missing" are n8n's `returnMessage` wording. */
const RETURN_MESSAGES: Record<ReturnDecision['code'], string> = {
  eligible: 'Order is eligible for return.',
  expired: 'Return period has expired.',
  date_missing: 'Delivery date is missing. Unable to process return.',
  date_invalid: 'Delivery date format is invalid. Unable to process return.',
  not_delivered: 'This order has not been delivered yet, so it cannot be returned.',
  cancelled: 'This order was cancelled, so there is nothing to return.',
  already_initiated: 'A return has already been started for this order.',
};

export function returnStatus(order: OrderRecord, ctx: RuleContext): LuminaResponse {
  const decision = evaluateReturn(order, ctx);
  return withIntentAliases({
    success: true,
    outcome: decision.canReturn ? 'success' : 'not_eligible',
    intent: 'return_item',
    message: RETURN_MESSAGES[decision.code],
    orderFound: true,
    canReturn: decision.canReturn,
    daysSinceDelivery: decision.daysSinceDelivery ?? null,
  });
}

/** n8n "Build Return Confirmation Message", without the bullet list and IDs. */
export function returnConfirmation(order: OrderRecord): LuminaResponse {
  const item = speakable(order.item);
  return withIntentAliases({
    success: true,
    outcome: 'success',
    intent: 'return_item',
    message: `Your return${item ? ` for the ${item}` : ''} has been started. Our team will contact you soon to arrange the pickup. Thank you for your patience.`,
    orderFound: true,
    canReturn: false,
    returnStatus: 'initiated',
  });
}

// ---------------------------------------------------------------------------
// Refund (n8n "Evaluate Refund Eligibility Policy")
// ---------------------------------------------------------------------------

export type RefundDecision =
  | { canRefund: true; code: 'eligible'; daysSinceDelivery: number }
  | {
      canRefund: false;
      code:
        | 'date_missing'
        | 'date_invalid'
        | 'already_refunded'
        | 'in_progress'
        | 'item_opened'
        | 'return_not_initiated'
        | 'expired';
      daysSinceDelivery?: number;
    };

export function isRefundInitiated(order: OrderRecord): boolean {
  return normalizeStatus(order.refundStatus) === 'initiated';
}

/**
 * Rule, checked in n8n's order: delivery date known, not already refunded,
 * item unopened, return initiated, and within 14 days of delivery.
 */
export function evaluateRefund(order: OrderRecord, ctx: RuleContext): RefundDecision {
  const delivery = parseDeliveryDate(order.deliveryDate);
  if (delivery.kind === 'missing') return { canRefund: false, code: 'date_missing' };
  if (delivery.kind === 'invalid') return { canRefund: false, code: 'date_invalid' };
  const daysSinceDelivery = ctx.today - delivery.day;

  if (normalizeStatus(order.refundStatus) === 'completed') {
    return { canRefund: false, code: 'already_refunded', daysSinceDelivery };
  }
  // Hardening: a refund that was already started is not offered again.
  if (isRefundInitiated(order)) return { canRefund: false, code: 'in_progress', daysSinceDelivery };

  const condition = normalizeStatus(order.itemCondition);
  if (condition && condition !== 'unopened') {
    return { canRefund: false, code: 'item_opened', daysSinceDelivery };
  }
  if (!isReturnInitiated(order)) {
    return { canRefund: false, code: 'return_not_initiated', daysSinceDelivery };
  }
  return daysSinceDelivery <= REFUND_POLICY_DAYS
    ? { canRefund: true, code: 'eligible', daysSinceDelivery }
    : { canRefund: false, code: 'expired', daysSinceDelivery };
}

function refundAmountOf(order: OrderRecord): string | null {
  const amount = speakable(order.price, 20);
  return amount || null;
}

export function refundStatus(order: OrderRecord, ctx: RuleContext): LuminaResponse {
  const decision = evaluateRefund(order, ctx);
  const item = speakable(order.item);
  const subject = item ? `Your order for the ${item}` : 'Your order';
  const amount = refundAmountOf(order);

  const messages: Record<RefundDecision['code'], string> = {
    eligible: `${subject} is eligible for a refund${amount ? ` of ${amount} ${ctx.currency}` : ''}. Would you like me to process the refund now?`,
    date_missing: `${subject} cannot be refunded because the delivery date is missing.`,
    date_invalid: `${subject} cannot be refunded because the delivery date is not valid.`,
    already_refunded: `${subject} has already been refunded.`,
    in_progress: `A refund for ${subject.replace(/^Your/, 'your')} is already in progress.`,
    item_opened: `${subject} is not eligible for a refund because the item was opened.`,
    return_not_initiated: `${subject} cannot be refunded because the return has not been initiated yet.`,
    expired: `${subject} is not eligible for a refund because the refund period has expired.`,
  };

  return {
    success: true,
    outcome: decision.canRefund ? 'success' : 'not_eligible',
    intent: 'refund_order',
    message: messages[decision.code],
    orderFound: true,
    canRefund: decision.canRefund,
    refundAmount: decision.canRefund ? amount : null,
    daysSinceDelivery: decision.daysSinceDelivery ?? null,
  };
}

/** n8n "Build Refund Confirmation Message", without the bullet list and IDs. */
export function refundConfirmation(order: OrderRecord, ctx: RuleContext): LuminaResponse {
  const amount = speakable(order.refundAmount, 20) || refundAmountOf(order);
  return {
    success: true,
    outcome: 'success',
    intent: 'refund_order',
    message: `Your refund${amount ? ` of ${amount} ${ctx.currency}` : ''} has been started. It will be credited to your original payment method within 5 to 7 business days. Thank you for your patience.`,
    orderFound: true,
    canRefund: false,
    refundStatus: 'initiated',
    refundAmount: amount,
  };
}
