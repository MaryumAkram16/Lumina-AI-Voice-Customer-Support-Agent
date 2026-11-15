import { createSign } from 'node:crypto';
import { DataSourceError } from './types.js';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Accepts the service-account JSON as-is or base64-encoded. Never logs it. */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
  }
  const account = parsed as Partial<ServiceAccount>;
  if (typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }
  return {
    client_email: account.client_email,
    private_key: account.private_key.replace(/\\n/g, '\n'),
    token_uri: typeof account.token_uri === 'string' ? account.token_uri : DEFAULT_TOKEN_URI,
  };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Signed JWT for the OAuth 2.0 service-account (JWT bearer) flow. */
export function buildAssertion(account: ServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(account.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

type Fetch = typeof fetch;

/** Fetches and caches a Google access token until shortly before it expires. */
export class GoogleTokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: Fetch,
    private readonly timeoutMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    this.pending ??= this.requestToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async requestToken(): Promise<string> {
    const assertion = buildAssertion(this.account, Math.floor(this.now() / 1000));
    let response: Response;
    try {
      response = await this.fetchImpl(this.account.token_uri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DataSourceError('timeout', 'Google token request failed or timed out');
    }
    if (!response.ok) {
      throw new DataSourceError(
        response.status >= 500 ? 'unavailable' : 'unauthorized',
        `Google token request was rejected with status ${response.status}`,
      );
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      throw new DataSourceError('unauthorized', 'Google token response had no access token');
    }
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.cached = { token: body.access_token, expiresAt: this.now() + lifetime * 1000 };
    return body.access_token;
  }
}
