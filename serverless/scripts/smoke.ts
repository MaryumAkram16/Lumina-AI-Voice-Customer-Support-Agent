/**
 * Smoke test for a running deployment.
 *
 *   RETELL_API_KEY=... npm run smoke -- https://your-app.vercel.app
 *   RETELL_API_KEY=... npm run smoke -- http://localhost:3000 --mutate
 *
 * Sends requests signed the way Retell signs them and checks status codes
 * and response shape. Read-only by default; `--mutate` also cancels a demo
 * order twice to prove the second call changes nothing. Order-specific
 * checks only run when the deployment reports `data_source: "demo"`.
 */
import { signRetellBody } from '../lib/signature.js';

const args = process.argv.slice(2);
const baseUrl = args.find((arg) => !arg.startsWith('--'))?.replace(/\/$/, '');
const mutate = args.includes('--mutate');
const apiKey = process.env.RETELL_API_KEY ?? '';

if (!baseUrl || !apiKey) {
  console.error('Usage: RETELL_API_KEY=<key> npm run smoke -- <base-url> [--mutate]');
  process.exit(2);
}

interface Result {
  status: number;
  body: Record<string, unknown>;
  ms: number;
}

async function call(
  path: string,
  payload: unknown,
  options: { method?: string; sign?: boolean; tamper?: boolean } = {},
): Promise<Result> {
  const method = options.method ?? 'POST';
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.sign !== false) headers['x-retell-signature'] = await signRetellBody(raw, apiKey);
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: options.tamper ? raw.replace('001', '002') : raw }),
  });
  const ms = Math.round(performance.now() - started);
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body: the status check below will report it.
  }
  return { status: response.status, body, ms };
}

let failures = 0;
function check(name: string, result: Result, ok: boolean): void {
  if (!ok) failures += 1;
  const message = typeof result.body.message === 'string' ? ` "${result.body.message}"` : '';
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}  [${result.status}, ${result.ms} ms]${ok ? '' : message}`,
  );
}

const track001 = { order_id: 'ORD-TEST-001', intent: 'track_order', email: 'alex@example.test' };

const health = await call('/api/health', null, { method: 'GET', sign: false });
check('health is ok', health, health.status === 200 && health.body.status === 'ok');
const demo = health.body.data_source === 'demo';
console.log(`      data source: ${String(health.body.data_source)}`);

const pageResponse = await fetch(`${baseUrl}/`);
const pageHtml = await pageResponse.text();
check(
  'demo page is served',
  { status: pageResponse.status, body: {}, ms: 0 },
  pageResponse.status === 200 && pageHtml.includes('Talk to Lumina'),
);
console.log(
  `      browser calls: ${health.body.web_call === true ? 'on' : 'off (RETELL_AGENT_ID not set)'}`,
);

// No Origin header, as from a script: must be refused without starting a call.
const strayWebCall = await call('/api/create-web-call', {}, { sign: false });
check(
  'web call refuses requests that are not from the page',
  strayWebCall,
  strayWebCall.status === 403,
);

const unsigned = await call('/api/track-order', track001, { sign: false });
check('unsigned request is rejected', unsigned, unsigned.status === 401);

const tampered = await call('/api/track-order', track001, { tamper: true });
check('tampered body is rejected', tampered, tampered.status === 401);

const wrongMethod = await call('/api/track-order', null, { method: 'GET', sign: false });
check('GET is rejected', wrongMethod, wrongMethod.status === 405);

const unknownField = await call('/api/track-order', { ...track001, is_admin: true });
check('unknown field is rejected', unknownField, unknownField.status === 400);

const missing = await call('/api/track-order', { order_id: 'ORD-TEST-999', intent: 'track_order' });
check(
  'unknown order gets a safe answer',
  missing,
  missing.status === 200 && missing.body.success === false && !('status' in missing.body),
);

if (demo) {
  const track = await call('/api/track-order', track001);
  check(
    'track order',
    track,
    track.status === 200 && track.body.success === true && track.body.status === 'shipped',
  );

  const viaOrder = await call('/api/order', track001);
  check(
    'track via /api/order',
    viaOrder,
    viaOrder.status === 200 && viaOrder.body.success === true,
  );

  const cancel = await call('/api/cancel-order', {
    order_id: 'ORD-TEST-004',
    intent: 'cancel_order',
    email: 'jordan@example.test',
  });
  check('cancel eligibility', cancel, cancel.status === 200 && cancel.body.canCancel === true);

  const wrongEmail = await call('/api/cancel-order', {
    order_id: 'ORD-TEST-004',
    intent: 'cancel_order',
    email: 'someone-else@example.test',
  });
  const noSuchOrder = await call('/api/cancel-order', {
    order_id: 'ORD-TEST-999',
    intent: 'cancel_order',
    email: 'jordan@example.test',
  });
  check(
    'wrong email looks like a missing order',
    wrongEmail,
    wrongEmail.status === 200 && wrongEmail.body.message === noSuchOrder.body.message,
  );

  const returns = await call('/api/return-item', {
    order_id: 'ORD-TEST-005',
    intent: 'return_item',
    phone_no: '+1-555-0105',
  });
  check('return eligibility', returns, returns.status === 200 && returns.body.canReturn === true);

  const refund = await call('/api/refund-eligibility', {
    order_id: 'ORD-TEST-006',
    intent: 'refund',
    email: 'riley@example.test',
  });
  check('refund eligibility', refund, refund.status === 200 && refund.body.canRefund === true);

  if (mutate) {
    const confirm = {
      order_id: 'ORD-TEST-004',
      intent: 'cancel_order',
      email: 'jordan@example.test',
      reason: 'smoke test',
      cancellation_initiated: 'yes',
    };
    const first = await call('/api/cancel-order', confirm);
    const second = await call('/api/cancel-order', confirm);
    check('cancel order', first, first.status === 200 && first.body.success === true);
    check(
      'repeat cancel is a no-op',
      second,
      second.status === 200 && second.body.message === first.body.message,
    );
  }
} else {
  console.log('      skipping demo-order checks (not the demo data source)');
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
