import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Live transcript relay for the Talk to Lumina page.
 *
 * Retell only streams a web call's transcript over its monitor WebSocket, and
 * that socket needs the secret API key, which must never reach a browser. So
 * the server opens the socket and relays what was said to the page as
 * server-sent events. Only the page that started the call can read it: the
 * create-web-call response carries a token signed for that one call.
 */

/** One thing someone said, as relayed to the page. Nothing else is forwarded. */
export interface Spoken {
  role: 'agent' | 'user';
  content: string;
  metadata?: { is_backchannel: true };
}

const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const CALL_ID = /^[A-Za-z0-9_-]{6,128}$/;

function tokenKey(apiKey: string): Buffer {
  // A key derived for this one purpose, so the token never exposes the API key.
  return createHmac('sha256', apiKey).update('lumina-transcript-token-v1').digest();
}

function mac(apiKey: string, callId: string, expires: number): string {
  return createHmac('sha256', tokenKey(apiKey)).update(`${callId}.${expires}`).digest('base64url');
}

export function isCallId(value: string | null): value is string {
  return value !== null && CALL_ID.test(value);
}

/** A token that lets its holder read the transcript of `callId` until it expires. */
export function signTranscriptToken(apiKey: string, callId: string, nowSeconds: number): string {
  const expires = nowSeconds + TOKEN_TTL_SECONDS;
  return `${expires}.${mac(apiKey, callId, expires)}`;
}

export function verifyTranscriptToken(
  apiKey: string,
  callId: string,
  token: string | null,
  nowSeconds: number,
): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!match?.[1] || !match[2]) return false;
  const expires = Number(match[1]);
  if (expires < nowSeconds) return false;
  const expected = Buffer.from(mac(apiKey, callId, expires));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Folds one monitor message's utterances into `seen`, which keeps each
 * utterance under its ID in the order it first appeared (later messages
 * replace an utterance as its text grows). Returns what the caller and the
 * agent said so far; tool calls, tool results and node changes are dropped
 * here, so they never leave the server.
 */
export function mergeUtterances(seen: Map<string, Spoken | null>, incoming: unknown): Spoken[] {
  if (Array.isArray(incoming)) {
    incoming.forEach((item: unknown, index) => {
      if (typeof item !== 'object' || item === null) return;
      const { id, role, content, metadata } = item as {
        id?: unknown;
        role?: unknown;
        content?: unknown;
        metadata?: { is_backchannel?: unknown };
      };
      const key = typeof id === 'string' && id ? id : `#${seen.size}-${index}`;
      const spoken =
        (role === 'agent' || role === 'user') && typeof content === 'string'
          ? {
              role,
              content: content.slice(0, 4000),
              ...(metadata?.is_backchannel === true ? { metadata: { is_backchannel: true } } : {}),
            }
          : null;
      seen.set(key, spoken as Spoken | null);
    });
  }
  return [...seen.values()].filter((value): value is Spoken => value !== null);
}

/** The minimum of the WebSocket API the relay uses, so tests can stand in for Retell. */
export interface MonitorSocket {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export type OpenMonitorSocket = (url: string, protocols: string[]) => MonitorSocket;

export const openWebSocket: OpenMonitorSocket = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as MonitorSocket;

export interface RelayHandlers {
  onTranscript(spoken: Spoken[]): void;
  /** The call is over. */
  onEnd(): void;
  /** Retell refused or kept dropping the stream; the call itself is unaffected. */
  onUnavailable(reason: string): void;
}

export interface RelayOptions {
  apiKey: string;
  callId: string;
  open?: OpenMonitorSocket;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Follows a call's transcript on Retell's monitor socket. Mirrors the Retell
 * browser client: close code 1000 means the call ended, 4004 means it is not
 * live yet (retry), other 4xxx codes are refusals, anything else is retried.
 * Returns a function that stops following.
 */
export function relayCallTranscript(options: RelayOptions, handlers: RelayHandlers): () => void {
  const open = options.open ?? openWebSocket;
  const base = (options.baseUrl ?? 'wss://api.retellai.com').replace(/\/+$/, '');
  const url = `${base}/v2/monitor-call/${encodeURIComponent(options.callId)}`;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const seen = new Map<string, Spoken | null>();
  let socket: MonitorSocket | null = null;
  let stopped = false;
  let attempts = 0;

  const finish = (outcome: () => void) => {
    if (stopped) return;
    stopped = true;
    socket?.close();
    socket = null;
    outcome();
  };

  const connect = () => {
    if (stopped) return;
    let ws: MonitorSocket;
    try {
      ws = open(url, ['bearer', options.apiKey]);
    } catch {
      finish(() => {
        handlers.onUnavailable('could not open the monitor socket');
      });
      return;
    }
    socket = ws;
    ws.onmessage = (event) => {
      if (stopped || ws !== socket) return;
      let message: { type?: unknown; transcripts?: unknown };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      attempts = 0;
      if (message.type === 'transcript_snapshot' || message.type === 'transcript_updated') {
        handlers.onTranscript(mergeUtterances(seen, message.transcripts));
      } else if (message.type === 'call_ended') {
        finish(() => {
          handlers.onEnd();
        });
      }
    };
    ws.onerror = () => undefined;
    ws.onclose = ({ code }) => {
      if (stopped || ws !== socket) return;
      socket = null;
      if (code === 1000) {
        finish(() => {
          handlers.onEnd();
        });
        return;
      }
      const retryable = code === 4004 || code < 4000 || code > 4999;
      if (!retryable || ++attempts > 8) {
        finish(() => {
          handlers.onUnavailable(`monitor closed with code ${code}`);
        });
        return;
      }
      void sleep(Math.min(8000, 500 * 2 ** (attempts - 1))).then(connect);
    };
  };

  connect();
  return () => {
    finish(() => undefined);
  };
}
