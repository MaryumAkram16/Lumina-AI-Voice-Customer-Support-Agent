import { DEMO_ORDERS, type DemoOrder } from './demo-orders.js';
import {
  canonicalOrderId,
  type OrderPatch,
  type OrderRecord,
  type OrderRepository,
} from './types.js';

const DAY_MS = 86_400_000;

/**
 * In-memory adapter over the synthetic demo orders. It never reads or writes
 * anything outside this process, so a public demo cannot touch real data.
 *
 * Changes (a demo cancellation, for example) live only as long as the warm
 * serverless instance and then reset to the fixtures.
 */
export class DemoOrderRepository implements OrderRepository {
  readonly name = 'demo' as const;
  private readonly seeds = new Map<string, DemoOrder>();
  private readonly patches = new Map<string, OrderPatch>();

  constructor(
    orders: readonly DemoOrder[] = DEMO_ORDERS,
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const order of orders) this.seeds.set(canonicalOrderId(order.order_id), order);
  }

  findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const key = canonicalOrderId(orderId);
    const seed = this.seeds.get(key);
    if (!seed) return Promise.resolve(null);
    return Promise.resolve({ ...this.toRecord(seed), ...this.patches.get(key) });
  }

  update(orderId: string, patch: OrderPatch): Promise<void> {
    const key = canonicalOrderId(orderId);
    if (this.seeds.has(key)) this.patches.set(key, { ...this.patches.get(key), ...patch });
    return Promise.resolve();
  }

  private toRecord(seed: DemoOrder): OrderRecord {
    const deliveryDate =
      seed.delivery_offset_days === undefined
        ? seed.delivery_date
        : new Date(this.now().getTime() + seed.delivery_offset_days * DAY_MS)
            .toISOString()
            .slice(0, 10);
    return {
      orderId: seed.order_id,
      customerName: seed.customer_name,
      email: seed.email,
      phone: seed.phone_no,
      status: seed.status,
      carrier: seed.carrier,
      trackingNumber: seed.tracking_number,
      deliveryDate,
      deliveryLocation: seed.delivery_location,
      trackingSteps: [...seed.tracking_steps],
      item: seed.item ?? null,
      price: seed.price ?? null,
      itemCondition: seed.item_condition ?? null,
      cancelDate: null,
      cancelReason: null,
      returnStatus: seed.return_status ?? null,
      returnReason: null,
      returnInitiatedAt: null,
      refundStatus: seed.refund_status ?? null,
      refundAmount: null,
      refundDate: null,
    };
  }
}
