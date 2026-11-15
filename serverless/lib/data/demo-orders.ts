/**
 * Synthetic demo orders. Nothing here is real customer data: `.test` email
 * domains, 555 phone numbers, test order IDs and test tracking numbers.
 *
 * The first three orders mirror `demo/orders.json` exactly (a test fails if
 * they drift). The rest exist so the public demo can always show an eligible
 * cancellation, return and refund: their delivery date is an offset from
 * today instead of a fixed date that would go stale.
 */

export interface DemoOrder {
  order_id: string;
  customer_name: string;
  email: string;
  phone_no: string;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  /** Fixed ISO date, or null. Ignored when `delivery_offset_days` is set. */
  delivery_date: string | null;
  /** Delivery date relative to today, in days (negative = in the past). */
  delivery_offset_days?: number;
  delivery_location: string;
  tracking_steps: string[];
  item?: string;
  price?: string;
  item_condition?: string;
  return_status?: string;
  refund_status?: string;
}

export const DEMO_ORDERS: readonly DemoOrder[] = [
  {
    order_id: 'ORD-TEST-001',
    customer_name: 'Alex Example',
    email: 'alex@example.test',
    phone_no: '+1-555-0101',
    status: 'shipped',
    carrier: 'UPS',
    tracking_number: '1ZTEST00000000001',
    delivery_date: '2026-12-31',
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit'],
  },
  {
    order_id: 'ORD-TEST-002',
    customer_name: 'Sam Example',
    email: 'sam@example.test',
    phone_no: '+1-555-0102',
    status: 'processing',
    carrier: null,
    tracking_number: null,
    delivery_date: null,
    delivery_location: 'Test City',
    tracking_steps: ['Order received'],
  },
  {
    order_id: 'ORD-TEST-003',
    customer_name: 'Taylor Example',
    email: 'taylor@example.test',
    phone_no: '+1-555-0103',
    status: 'delivered',
    carrier: 'USPS',
    tracking_number: '9400TEST0000000003',
    delivery_date: '2026-08-20',
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit', 'Delivered'],
  },
  {
    order_id: 'ORD-TEST-004',
    customer_name: 'Jordan Example',
    email: 'jordan@example.test',
    phone_no: '+1-555-0104',
    status: 'processing',
    carrier: 'FedEx',
    tracking_number: 'TESTFEDEX0000004',
    delivery_date: null,
    delivery_offset_days: 5,
    delivery_location: 'Test City',
    tracking_steps: ['Order received', 'Packed'],
    item: 'Desk Lamp',
    price: '3200',
  },
  {
    order_id: 'ORD-TEST-005',
    customer_name: 'Casey Example',
    email: 'casey@example.test',
    phone_no: '+1-555-0105',
    status: 'delivered',
    carrier: 'UPS',
    tracking_number: '1ZTEST00000000005',
    delivery_date: null,
    delivery_offset_days: -3,
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit', 'Delivered'],
    item: 'Wireless Headphones',
    price: '4500',
    item_condition: 'unopened',
  },
  {
    order_id: 'ORD-TEST-006',
    customer_name: 'Riley Example',
    email: 'riley@example.test',
    phone_no: '+1-555-0106',
    status: 'delivered',
    carrier: 'USPS',
    tracking_number: '9400TEST0000000006',
    delivery_date: null,
    delivery_offset_days: -5,
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit', 'Delivered'],
    item: 'Coffee Grinder',
    price: '12999',
    item_condition: 'unopened',
    return_status: 'initiated',
  },
  {
    order_id: 'ORD-TEST-007',
    customer_name: 'Morgan Example',
    email: 'morgan@example.test',
    phone_no: '+1-555-0107',
    status: 'delivered',
    carrier: 'UPS',
    tracking_number: '1ZTEST00000000007',
    delivery_date: null,
    delivery_offset_days: -30,
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit', 'Delivered'],
    item: 'Travel Backpack',
    price: '8900',
    item_condition: 'unopened',
    return_status: 'initiated',
  },
  {
    order_id: 'ORD-TEST-008',
    customer_name: 'Avery Example',
    email: 'avery@example.test',
    phone_no: '+1-555-0108',
    status: 'delivered',
    carrier: 'FedEx',
    tracking_number: 'TESTFEDEX0000008',
    delivery_date: null,
    delivery_offset_days: -4,
    delivery_location: 'Test City',
    tracking_steps: ['Label created', 'In transit', 'Delivered'],
    item: 'Bluetooth Speaker',
    price: '6400',
    item_condition: 'opened',
    return_status: 'initiated',
  },
];
