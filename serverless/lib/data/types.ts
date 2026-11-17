/**
 * Data-layer contract. Routes and business rules only ever see `OrderRecord`
 * and `OrderRepository`, never a sheet row or a fixture file.
 */

export interface OrderRecord {
  orderId: string;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  /** Raw status text from the data source, e.g. "Shipped". */
  status: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  /** Raw delivery date text. n8n stores DD-MM-YY; ISO YYYY-MM-DD is also accepted. */
  deliveryDate: string | null;
  deliveryLocation: string | null;
  trackingSteps: string[];
  item: string | null;
  price: string | null;
  itemCondition: string | null;
  cancelDate: string | null;
  cancelReason: string | null;
  returnStatus: string | null;
  returnReason: string | null;
  returnInitiatedAt: string | null;
  refundStatus: string | null;
  refundAmount: string | null;
  refundDate: string | null;
}

/** Fields a state-changing action is allowed to write. */
export type OrderPatch = Partial<
  Pick<
    OrderRecord,
    | 'status'
    | 'cancelDate'
    | 'cancelReason'
    | 'itemCondition'
    | 'returnStatus'
    | 'returnReason'
    | 'returnInitiatedAt'
    | 'refundStatus'
    | 'refundAmount'
    | 'refundDate'
  >
>;

export interface OrderRepository {
  readonly name: 'demo' | 'sheets' | 'supabase';
  /** Look up one order. `orderId` is matched on its canonical form (see `canonicalOrderId`). */
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  /** Persist a patch. Must be safe to repeat with the same arguments. */
  update(orderId: string, patch: OrderPatch): Promise<void>;
}

/** Raised when the data source is unreachable, slow, or returns something unusable. */
export class DataSourceError extends Error {
  constructor(
    /** Safe, non-sensitive category for logs. */
    readonly category: 'timeout' | 'unavailable' | 'unauthorized' | 'schema' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/**
 * Order IDs are compared on letters and digits only, upper-cased, so that
 * "ord test 001", "ORD_TEST_001" and "ORD-TEST-001" (typical speech-to-text
 * variations) all resolve to the same order.
 */
export function canonicalOrderId(orderId: string): string {
  return orderId.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
