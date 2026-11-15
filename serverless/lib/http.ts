import { randomUUID } from 'node:crypto';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { createRepository } from './data/index.js';
import { DataSourceError, type OrderRepository } from './data/types.js';
import { createLogger, type Logger } from './logger.js';
import { RateLimiter } from './rate-limit.js';
import { resolveIntent, type Intent } from './rules.js';
import { parseRequestBody } from './schema.js';
import { OrderService } from './service.js';
import { SIGNATURE_HEADER, verifyRetellSignature } from './signature.js';

/** A dedicated route fixes the intent; `order` reads it from the body like n8n does. */
export type Route = Intent | 'order';

export interface AppDeps {
  config: AppConfig;
  repository?: OrderRepository;
  logger?: Logger;
  now?: () => Date;
}

type ErrorCode =
  | 'method_not_allowed'
  | 'origin_not_allowed'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unauthorized'
  | 'unsupported_media_type'
  | 'invalid_json'
  | 'invalid_request'
  | 'invalid_intent'
  | 'service_unavailable'
  | 'internal_error';

/** Every error still carries a sentence the agent can say out loud. */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: 'This endpoint only accepts POST requests.',
  origin_not_allowed: 'This request is not allowed from that origin.',
  rate_limited: "I'm getting a lot of requests right now. Please give me a moment and try again.",
  payload_too_large: 'That request was too large to process.',
  unauthorized: 'This request could not be authorized.',
  unsupported_media_type: 'This endpoint only accepts JSON.',
  invalid_json: "I couldn't read that request. Could you say that again?",
  invalid_request: "I couldn't process that request. Could you repeat the order number?",
  invalid_intent:
    'I can help with tracking an order, cancelling an order, a return, or a refund. Which would you like?',
  service_unavailable:
    "I'm having trouble reaching our order system right now. Please try again in a moment.",
  internal_error: 'Sorry, something went wrong on my side. Please try again in a moment.',
};

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const ROUTE_KEYWORD: Record<Intent, string> = {
  track_order: 'track',
  cancel_order: 'cancel',
  return_item: 'return',
  refund_order: 'refund',
};

function clientIp(request: Request): string {
  // On Vercel both headers are set by the platform and cannot be spoofed by the client.
  const real = request.headers.get('x-real-ip')?.trim();
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (real ?? forwarded ?? 'unknown').slice(0, 64);
}

/** Reads the body as text, giving up as soon as it exceeds `maxBytes`. */
async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface App {
  handle(route: Route, request: Request): Promise<Response>;
  health(request: Request): Response;
}

export function createApp(deps: AppDeps): App {
  const { config } = deps;
  const baseLogger = deps.logger ?? createLogger();
  const now = deps.now ?? (() => new Date());
  const repository = deps.repository ?? createRepository(config);
  const limiter = new RateLimiter(config.rateLimit.windowMs);
  // One service per app, so its per-order locks span requests.
  const service = new OrderService({
    repository,
    now,
    businessTimeZone: config.businessTimeZone,
    currency: config.currency,
    logger: baseLogger,
  });

  function respond(
    status: number,
    body: Record<string, unknown>,
    requestId: string,
    extra: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...SECURITY_HEADERS, 'x-request-id': requestId, ...extra },
    });
  }

  function fail(
    status: number,
    code: ErrorCode,
    requestId: string,
    extra: Record<string, string> = {},
  ): Response {
    return respond(
      status,
      {
        success: false,
        outcome: status >= 500 ? 'provider_error' : 'validation_error',
        error: code,
        message: ERROR_MESSAGES[code],
        request_id: requestId,
      },
      requestId,
      extra,
    );
  }

  /** CORS is closed by default: only origins in ALLOWED_ORIGINS get headers. */
  function corsHeaders(origin: string | null): Record<string, string> | null {
    if (!origin) return {};
    if (!config.allowedOrigins.includes(origin.replace(/\/$/, ''))) return null;
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': `content-type, ${SIGNATURE_HEADER}`,
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }

  async function handle(route: Route, request: Request): Promise<Response> {
    const requestId = randomUUID();
    const started = Date.now();
    const logger = baseLogger.child({ request_id: requestId, route });
    const done = (response: Response, fields: Record<string, unknown> = {}): Response => {
      logger.log(response.status >= 500 ? 'error' : 'info', 'request_completed', {
        status: response.status,
        duration_ms: Date.now() - started,
        ...fields,
      });
      return response;
    };

    try {
      // 1. Origin: browsers must be on the allow-list; Retell sends no Origin.
      const cors = corsHeaders(request.headers.get('origin'));
      if (cors === null) return done(fail(403, 'origin_not_allowed', requestId));

      // 2. Method.
      if (request.method === 'OPTIONS' && 'access-control-allow-origin' in cors) {
        return done(new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...cors } }));
      }
      if (request.method !== 'POST') {
        return done(fail(405, 'method_not_allowed', requestId, { allow: 'POST' }));
      }

      // 3. Rate limit per client IP, before any expensive work.
      const ipLimit = limiter.check(`ip:${clientIp(request)}`, config.rateLimit.maxPerIp);
      if (!ipLimit.allowed) {
        return done(
          fail(429, 'rate_limited', requestId, {
            'retry-after': String(ipLimit.retryAfterSeconds),
          }),
        );
      }

      // 4. Body size.
      const rawBody = await readBody(request, config.maxBodyBytes);
      if (rawBody === null) return done(fail(413, 'payload_too_large', requestId));

      // 5. Signature, checked against the raw bytes before anything is parsed.
      const signed = await verifyRetellSignature(
        rawBody,
        config.retellApiKey,
        request.headers.get(SIGNATURE_HEADER),
      );
      if (!signed) return done(fail(401, 'unauthorized', requestId));

      // 6. Content type.
      const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        return done(fail(415, 'unsupported_media_type', requestId));
      }

      // 7. JSON, then strict schema.
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return done(fail(400, 'invalid_json', requestId));
      }
      const parsed = parseRequestBody(json);
      if (!parsed.ok) {
        logger.log('warn', 'request_rejected', { issues: parsed.issues });
        return done(fail(400, 'invalid_request', requestId));
      }
      const luminaRequest = parsed.request;

      // 8. Rate limit per call, when Retell tells us which call this is.
      if (luminaRequest.callId) {
        const callLimit = limiter.check(
          `call:${luminaRequest.callId}`,
          config.rateLimit.maxPerCall,
        );
        if (!callLimit.allowed) {
          return done(
            fail(429, 'rate_limited', requestId, {
              'retry-after': String(callLimit.retryAfterSeconds),
            }),
          );
        }
      }

      // 9. Intent.
      const spoken = luminaRequest.intent?.toLowerCase() ?? '';
      let intent: Intent | null;
      if (route === 'order') {
        intent = resolveIntent(luminaRequest.intent);
      } else {
        // On a dedicated route the URL decides. An intent that clearly names
        // a different action is a misrouted call and is rejected.
        const other = resolveIntent(luminaRequest.intent);
        const misrouted =
          other !== null && other !== route && !spoken.includes(ROUTE_KEYWORD[route]);
        intent = misrouted ? null : route;
      }
      if (!intent) return done(fail(400, 'invalid_intent', requestId));

      // 10. Business logic.
      const result = await service.withLogger(logger).handle(intent, luminaRequest);
      return done(respond(200, { ...result, request_id: requestId }, requestId, cors), {
        intent,
        outcome: result.outcome,
        event_id: luminaRequest.eventId,
        call_id: luminaRequest.callId,
        order_id: luminaRequest.orderId ?? undefined,
        email: luminaRequest.email,
        phone: luminaRequest.phone,
      });
    } catch (error) {
      // Details go to the log. The caller only ever gets a fixed sentence.
      if (error instanceof DataSourceError) {
        logger.log('error', 'data_source_error', {
          category: error.category,
          detail: error.message,
        });
        return done(fail(503, 'service_unavailable', requestId));
      }
      logger.log('error', 'unhandled_error', {
        error_name: error instanceof Error ? error.name : 'unknown',
        detail: error instanceof Error ? error.message : 'non-error thrown',
      });
      return done(fail(500, 'internal_error', requestId));
    }
  }

  function health(request: Request): Response {
    const requestId = randomUUID();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'method_not_allowed', requestId, { allow: 'GET' });
    }
    return respond(
      200,
      { status: 'ok', service: 'lumina-serverless', data_source: repository.name },
      requestId,
    );
  }

  return { handle, health };
}

// ---------------------------------------------------------------------------
// Vercel entry points
// ---------------------------------------------------------------------------

let defaultApp: App | null = null;

/** Builds the app from `process.env` once per instance; fails fast on bad config. */
function getDefaultApp(): App {
  defaultApp ??= createApp({ config: loadConfig() });
  return defaultApp;
}

function misconfigured(error: unknown, status: number): Response {
  const requestId = randomUUID();
  createLogger().log('error', 'config_invalid', {
    request_id: requestId,
    problems: error instanceof ConfigError ? error.problems : ['startup failed'],
  });
  return new Response(
    JSON.stringify({
      success: false,
      outcome: 'provider_error',
      error: 'internal_error',
      message: ERROR_MESSAGES.internal_error,
      request_id: requestId,
    }),
    { status, headers: { ...SECURITY_HEADERS, 'x-request-id': requestId } },
  );
}

/** Handler for an `api/*.ts` route file. */
export function routeHandler(route: Route): (request: Request) => Promise<Response> {
  return async (request) => {
    let app: App;
    try {
      app = getDefaultApp();
    } catch (error) {
      return misconfigured(error, 500);
    }
    return app.handle(route, request);
  };
}

export function healthHandler(): (request: Request) => Response {
  return (request) => {
    try {
      return getDefaultApp().health(request);
    } catch (error) {
      return misconfigured(error, 503);
    }
  };
}
