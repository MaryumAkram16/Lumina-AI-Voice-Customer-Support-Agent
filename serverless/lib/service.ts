import type { OrderRecord, OrderRepository } from './data/types.js';
import { canonicalOrderId } from './data/types.js';
import type { Logger } from './logger.js';
import * as rules from './rules.js';
import type { Intent, LuminaResponse, RuleContext } from './rules.js';
import type { LuminaRequest } from './schema.js';

export interface ServiceDeps {
  repository: OrderRepository;
  now: () => Date;
  businessTimeZone: string;
  currency: string;
  logger: Logger;
}

/**
 * Glue between the data layer and the pure rules: load the order, verify the
 * caller, apply the rule, and persist the result of a confirmed action.
 */
export class OrderService {
  constructor(
    private readonly deps: ServiceDeps,
    /** Serializes state changes per order within this instance. */
    private readonly locks = new Map<string, Promise<unknown>>(),
  ) {}

  /** Same service and locks, logging with a request-scoped logger. */
  withLogger(logger: Logger): OrderService {
    return new OrderService({ ...this.deps, logger }, this.locks);
  }

  async handle(intent: Intent, request: LuminaRequest): Promise<LuminaResponse> {
    if (!request.orderId) return rules.missingOrderId(intent);

    const identity = { email: request.email, phone: request.phone };
    const mustVerify = intent !== 'track_order';
    // Asked before the lookup, so the answer cannot reveal whether the order exists.
    if (mustVerify && !identity.email && !identity.phone) return rules.verificationRequired(intent);

    // A malformed ID still goes through the same lookup and verification
    // steps as a real one, so both take the same path and the same time.
    const order = await this.deps.repository.findByOrderId(
      request.orderIdWellFormed ? request.orderId : '',
    );
    const verification = rules.verifyIdentity(order, identity);
    if (!order || verification === 'mismatch') {
      this.deps.logger.log('info', 'order_lookup_failed', {
        reason: order ? 'verification_failed' : 'order_not_found',
      });
      return rules.notFound(intent);
    }

    const ctx = this.context();
    switch (intent) {
      case 'track_order':
        return rules.trackOrder(order, verification === 'verified', ctx);
      case 'cancel_order':
        return rules.isInitiated(request.cancellationInitiated)
          ? this.exclusive(intent, order, (fresh) => this.cancel(fresh, request))
          : rules.cancellationStatus(order, ctx);
      case 'return_item':
        return rules.isInitiated(request.returnInitiated)
          ? this.exclusive(intent, order, (fresh) => this.startReturn(fresh, request))
          : rules.returnStatus(order, ctx);
      case 'refund_order':
        return rules.isInitiated(request.refundInitiated)
          ? this.exclusive(intent, order, (fresh) => this.startRefund(fresh))
          : rules.refundStatus(order, ctx);
    }
  }

  private context(): RuleContext {
    const now = this.deps.now();
    return {
      today: rules.todayIn(now, this.deps.businessTimeZone),
      nowIso: now.toISOString(),
      currency: this.deps.currency,
    };
  }

  /**
   * Runs one state change at a time per order and re-reads the order inside
   * the lock, so two overlapping requests cannot both act on the old state.
   */
  private async exclusive(
    intent: Intent,
    order: OrderRecord,
    action: (fresh: OrderRecord) => Promise<LuminaResponse>,
  ): Promise<LuminaResponse> {
    const key = canonicalOrderId(order.orderId);
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const fresh = await this.deps.repository.findByOrderId(order.orderId);
        return fresh ? action(fresh) : rules.notFound(intent);
      });
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }

  /**
   * Idempotent by state: an order that is already cancelled gets the original
   * confirmation back and nothing is written a second time.
   */
  private async cancel(order: OrderRecord, request: LuminaRequest): Promise<LuminaResponse> {
    const ctx = this.context();
    if (rules.isCancelled(order))
      return asDuplicate(rules.cancellationConfirmation(order.cancelDate, ctx));

    // Hardening: n8n cancels without re-checking the window.
    const decision = rules.evaluateCancellation(order, ctx);
    if (!decision.canCancel) return { ...rules.cancellationStatus(order, ctx), success: false };

    await this.deps.repository.update(order.orderId, {
      status: 'cancelled',
      cancelDate: ctx.nowIso,
      cancelReason: request.reason ?? '',
    });
    this.deps.logger.log('info', 'order_cancelled', { order_id: order.orderId });
    return rules.cancellationConfirmation(ctx.nowIso, ctx);
  }

  private async startReturn(order: OrderRecord, request: LuminaRequest): Promise<LuminaResponse> {
    const ctx = this.context();
    if (rules.isReturnInitiated(order)) return asDuplicate(rules.returnConfirmation(order));

    const decision = rules.evaluateReturn(order, ctx);
    if (!decision.canReturn) return { ...rules.returnStatus(order, ctx), success: false };

    await this.deps.repository.update(order.orderId, {
      returnStatus: 'initiated',
      returnReason: request.reason ?? '',
      returnInitiatedAt: ctx.nowIso,
      ...(request.itemCondition ? { itemCondition: request.itemCondition } : {}),
    });
    this.deps.logger.log('info', 'return_initiated', { order_id: order.orderId });
    return rules.returnConfirmation(order);
  }

  private async startRefund(order: OrderRecord): Promise<LuminaResponse> {
    const ctx = this.context();
    if (rules.isRefundInitiated(order)) return asDuplicate(rules.refundConfirmation(order, ctx));

    const decision = rules.evaluateRefund(order, ctx);
    if (!decision.canRefund) return { ...rules.refundStatus(order, ctx), success: false };

    // Hardening: the amount is the order's price, never a number from the call.
    const refundAmount = order.price ?? '';
    await this.deps.repository.update(order.orderId, {
      refundStatus: 'initiated',
      refundAmount,
      refundDate: ctx.nowIso,
    });
    this.deps.logger.log('info', 'refund_initiated', { order_id: order.orderId });
    return rules.refundConfirmation({ ...order, refundAmount }, ctx);
  }
}

function asDuplicate(response: LuminaResponse): LuminaResponse {
  return { ...response, outcome: 'duplicate', duplicate: true };
}
