import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { createRepository } from './data/index.js';
import { DataSourceError, type OrderRepository } from './data/types.js';
import { createLogger, type Logger } from './logger.js';
import { RateLimiter } from './rate-limit.js';
import { resolveIntent, type Intent } from './rules.js';
import { parseRequestBody } from './schema.js';
import { OrderService } from './service.js';
import { SIGNATURE_HEADER, verifyRetellSignature } from './signature.js';
import {
  isCallId,
  relayCallTranscript,
  signTranscriptToken,
  verifyTranscriptToken,
  type OpenMonitorSocket,
} from './transcript.js';
import { createRetellWebCall } from './web-call.js';

/** A dedicated route fixes the intent; `order` reads it from the body like n8n does. */
export type Route = Intent | 'order';

export interface AppDeps {
  config: AppConfig;
  repository?: OrderRepository;
  logger?: Logger;
  now?: () => Date;
  /** Asks Retell for a web call. Injectable so tests never call Retell. */
  createWebCall?: (agentId: string) => Promise<Record<string, unknown>>;
  /** Opens Retell's monitor socket. Injectable so tests never call Retell. */
  openMonitorSocket?: OpenMonitorSocket;
  /**
   * How long one transcript stream stays open before the page reconnects.
   * Kept under the 10 s function limit in vercel.json; each reconnect starts
   * with the whole transcript, so the page loses nothing.
   */
  transcriptStreamMs?: number;
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
  | 'web_call_not_configured'
  | 'web_call_failed'
  | 'forbidden'
  | 'passcode_required'
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
  web_call_not_configured: 'The voice demo is not switched on for this deployment.',
  web_call_failed: "I couldn't start the call. Please try again in a moment.",
  forbidden: 'This transcript is not available.',
  passcode_required: 'This demo needs a valid demo code to start a call.',
  internal_error: 'Sorry, something went wrong on my side. Please try again in a moment.',
};

/** The only fields of Retell's create-web-call response the browser needs to join. */
const WEB_CALL_FIELDS = [
  'call_id',
  'access_token',
  'transport',
  'url',
  'ice_servers',
  'expires_at',
];

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
  webCall(request: Request): Promise<Response>;
  transcript(request: Request): Response;
  health(request: Request): Response;
}

export function createApp(deps: AppDeps): App {
  const { config } = deps;
  const baseLogger = deps.logger ?? createLogger();
  const now = deps.now ?? (() => new Date());
  const repository = deps.repository ?? createRepository(config);
  const limiter = new RateLimiter(config.rateLimit.windowMs);
  const webCallLimiter = new RateLimiter(config.webCall.windowMs);
  // Wrong demo codes get their own, tighter budget so guessing is slow.
  const passcodeLimiter = new RateLimiter(10 * 60_000);

  /** Constant-time comparison of the code a browser sent with WEB_CALL_PASSCODE. */
  function passcodeMatches(given: unknown): boolean {
    if (config.webCallPasscode === null) return true;
    if (typeof given !== 'string') return false;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(given.trim()), digest(config.webCallPasscode));
  }
  const createWebCall =
    deps.createWebCall ?? ((agentId) => createRetellWebCall(config.retellApiKey, agentId));
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

  /** True when the page that sent the request is this deployment or an allowed origin. */
  function isTrustedOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    if (config.allowedOrigins.includes(origin.replace(/\/$/, ''))) return true;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    const hosts = [
      request.headers.get('x-forwarded-host'),
      request.headers.get('host'),
      new URL(request.url).host,
    ];
    return hosts.some((host) => host?.split(',')[0]?.trim().toLowerCase() === originHost);
  }

  /**
   * Starts a browser call for the demo page. This is the one endpoint a
   * browser calls, so it cannot be signed by Retell. Instead: the page must be
   * served from this deployment (or an allowed origin), the agent is fixed by
   * configuration and nothing in the request body is used, and starts are
   * rate limited per IP and overall because every call costs Retell minutes.
   */
  async function webCall(request: Request): Promise<Response> {
    const requestId = randomUUID();
    const started = Date.now();
    const logger = baseLogger.child({ request_id: requestId, route: 'create_web_call' });
    const done = (response: Response, fields: Record<string, unknown> = {}): Response => {
      logger.log(response.status >= 500 ? 'error' : 'info', 'request_completed', {
        status: response.status,
        duration_ms: Date.now() - started,
        ...fields,
      });
      return response;
    };

    try {
      if (request.method !== 'POST') {
        return done(fail(405, 'method_not_allowed', requestId, { allow: 'POST' }));
      }
      if (!isTrustedOrigin(request)) return done(fail(403, 'origin_not_allowed', requestId));
      const cors = corsHeaders(request.headers.get('origin')) ?? {};

      const agentId = config.retellAgentId;
      if (!agentId) return done(fail(503, 'web_call_not_configured', requestId, cors));

      // Only the demo code is read from the body. The agent and everything
      // else about the call come from configuration.
      const raw = await readBody(request, 4096);
      if (raw === null) return done(fail(413, 'payload_too_large', requestId, cors));
      if (config.webCallPasscode !== null) {
        const guesses = passcodeLimiter.peek(`ip:${clientIp(request)}`, 10);
        if (!guesses.allowed) {
          return done(
            fail(429, 'rate_limited', requestId, {
              ...cors,
              'retry-after': String(guesses.retryAfterSeconds),
            }),
          );
        }
        let passcode: unknown;
        try {
          passcode = (JSON.parse(raw || '{}') as { passcode?: unknown }).passcode;
        } catch {
          passcode = undefined;
        }
        if (!passcodeMatches(passcode)) {
          passcodeLimiter.check(`ip:${clientIp(request)}`, 10);
          return done(fail(401, 'passcode_required', requestId, cors), {
            passcode: passcode === undefined ? 'missing' : 'wrong',
          });
        }
      }

      // Checked after the code, so wrong codes never use up real call starts.
      const perIp = webCallLimiter.check(`ip:${clientIp(request)}`, config.webCall.maxPerIp);
      const overall = perIp.allowed ? webCallLimiter.check('all', config.webCall.maxGlobal) : perIp;
      if (!overall.allowed) {
        return done(
          fail(429, 'rate_limited', requestId, {
            ...cors,
            'retry-after': String(overall.retryAfterSeconds),
          }),
        );
      }

      let call: Record<string, unknown>;
      try {
        call = await createWebCall(agentId);
      } catch (error) {
        logger.log('error', 'web_call_failed', {
          error_name: error instanceof Error ? error.name : 'unknown',
          detail: error instanceof Error ? error.message : 'non-error thrown',
        });
        return done(fail(502, 'web_call_failed', requestId, cors));
      }
      if (typeof call.access_token !== 'string' || typeof call.call_id !== 'string') {
        logger.log('error', 'web_call_failed', { detail: 'response had no access token' });
        return done(fail(502, 'web_call_failed', requestId, cors));
      }

      const body: Record<string, unknown> = Object.fromEntries(
        WEB_CALL_FIELDS.filter((field) => call[field] !== undefined).map((field) => [
          field,
          call[field],
        ]),
      );
      // Lets this page, and only this page, read the call's live transcript.
      body.transcript_token = signTranscriptToken(
        config.retellApiKey,
        call.call_id,
        Math.floor(now().getTime() / 1000),
      );
      return done(respond(200, body, requestId, cors), { call_id: call.call_id });
    } catch (error) {
      logger.log('error', 'unhandled_error', {
        error_name: error instanceof Error ? error.name : 'unknown',
        detail: error instanceof Error ? error.message : 'non-error thrown',
      });
      return done(fail(500, 'internal_error', requestId));
    }
  }

  /**
   * Streams a web call's live transcript to the page that started it, as
   * server-sent events. Retell's transcript stream needs the secret API key,
   * so the server holds it and relays only what the caller and Lumina said.
   * Each stream closes after `transcriptStreamMs`; the browser's EventSource
   * reconnects by itself and gets the whole transcript again.
   */
  function transcript(request: Request): Response {
    const requestId = randomUUID();
    const logger = baseLogger.child({ request_id: requestId, route: 'call_transcript' });
    if (request.method !== 'GET') {
      return fail(405, 'method_not_allowed', requestId, { allow: 'GET' });
    }
    const url = new URL(request.url);
    const callId = url.searchParams.get('call_id');
    const token = url.searchParams.get('token');
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (
      !isCallId(callId) ||
      !verifyTranscriptToken(config.retellApiKey, callId, token, nowSeconds)
    ) {
      logger.log('warn', 'transcript_forbidden', {});
      return fail(403, 'forbidden', requestId);
    }
    const ip = limiter.check(`transcript:${clientIp(request)}`, config.rateLimit.maxPerIp);
    if (!ip.allowed) {
      return fail(429, 'rate_limited', requestId, { 'retry-after': String(ip.retryAfterSeconds) });
    }

    const encoder = new TextEncoder();
    let cleanup = (): void => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let stop = (): void => undefined;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          stop();
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        };
        cleanup = close;

        // Reconnect quickly when this stream reaches its lifetime.
        controller.enqueue(encoder.encode('retry: 500\n\n'));
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            close();
          }
        }, 15_000);
        const lifetime = setTimeout(close, deps.transcriptStreamMs ?? 8_000);
        request.signal.addEventListener('abort', close);
        stop = relayCallTranscript(
          {
            apiKey: config.retellApiKey,
            callId,
            ...(deps.openMonitorSocket ? { open: deps.openMonitorSocket } : {}),
          },
          {
            onTranscript: (spoken) => {
              send('transcript', { utterances: spoken });
            },
            onEnd: () => {
              send('end', {});
              close();
            },
            onUnavailable: (reason) => {
              logger.log('warn', 'transcript_unavailable', { detail: reason, call_id: callId });
              send('unavailable', {});
              close();
            },
          },
        );
      },
      cancel() {
        cleanup();
      },
    });

    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      'x-request-id': requestId,
    };
    return new Response(stream, { status: 200, headers });
  }

  function health(request: Request): Response {
    const requestId = randomUUID();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'method_not_allowed', requestId, { allow: 'GET' });
    }
    return respond(
      200,
      {
        status: 'ok',
        service: 'lumina-serverless',
        data_source: repository.name,
        web_call: config.retellAgentId !== null,
        passcode: config.webCallPasscode !== null,
      },
      requestId,
    );
  }

  return { handle, webCall, transcript, health };
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

/** Handler for `api/create-web-call.ts`. */
export function webCallHandler(): (request: Request) => Promise<Response> {
  return async (request) => {
    let app: App;
    try {
      app = getDefaultApp();
    } catch (error) {
      return misconfigured(error, 500);
    }
    return app.webCall(request);
  };
}

/** Handler for `api/call-transcript.ts`. */
export function transcriptHandler(): (request: Request) => Response {
  return (request) => {
    let app: App;
    try {
      app = getDefaultApp();
    } catch (error) {
      return misconfigured(error, 500);
    }
    return app.transcript(request);
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
