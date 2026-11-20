/**
 * Environment configuration. Everything secret comes from environment
 * variables; nothing is read from files and nothing is logged by value.
 */

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    // Variable names only. Values never appear in the message.
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  production: boolean;
  dataSource: 'demo' | 'sheets' | 'supabase';
  retellApiKey: string;
  /** Agent the browser demo calls. Null switches the web-call endpoint off. */
  retellAgentId: string | null;
  /** When set, a browser must send this code to start a call. Null means no code. */
  webCallPasscode: string | null;
  /** Limits on starting browser calls, which cost Retell minutes. */
  webCall: { windowMs: number; maxPerIp: number; maxGlobal: number };
  allowedOrigins: readonly string[];
  maxBodyBytes: number;
  rateLimit: { windowMs: number; maxPerIp: number; maxPerCall: number };
  businessTimeZone: string;
  currency: string;
  sheets: {
    serviceAccountJson: string;
    sheetId: string;
    tab: string;
    timeoutMs: number;
    retries: number;
    backoffMs: number;
    cacheTtlMs: number;
  } | null;
  supabase: {
    url: string;
    serviceKey: string;
    table: string;
    timeoutMs: number;
    retries: number;
    backoffMs: number;
  } | null;
}

type Env = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER = /^(replace|your[-_ ]|changeme|example|test$|xxx)/i;

function int(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

/**
 * Reads and validates configuration. Throws `ConfigError` listing every
 * problem at once, so a bad deployment fails on its first request instead of
 * half-working.
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];
  const production = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';

  // Default to the demo adapter so a deployment never touches real data unless asked to.
  const dataSourceRaw = (env.DATA_SOURCE?.trim() || 'demo').toLowerCase();
  if (dataSourceRaw !== 'demo' && dataSourceRaw !== 'sheets' && dataSourceRaw !== 'supabase') {
    problems.push('DATA_SOURCE must be "demo", "sheets" or "supabase"');
  }
  const dataSource =
    dataSourceRaw === 'sheets' || dataSourceRaw === 'supabase' ? dataSourceRaw : 'demo';

  // Required everywhere, not only in production: without it requests cannot
  // be verified, and Vercel preview deployments are public URLs too.
  const retellApiKey = env.RETELL_API_KEY?.trim() ?? '';
  if (!retellApiKey) {
    problems.push('RETELL_API_KEY is required');
  } else if (production && (retellApiKey.length < 16 || PLACEHOLDER.test(retellApiKey))) {
    problems.push('RETELL_API_KEY looks like a placeholder');
  }

  const retellAgentId = env.RETELL_AGENT_ID?.trim() || null;
  if (retellAgentId && !/^[A-Za-z0-9_-]{6,100}$/.test(retellAgentId)) {
    problems.push('RETELL_AGENT_ID is not a valid agent ID');
  }

  const webCallPasscode = env.WEB_CALL_PASSCODE?.trim() || null;
  if (webCallPasscode && !/^[\x21-\x7e]{4,64}$/.test(webCallPasscode)) {
    problems.push('WEB_CALL_PASSCODE must be 4 to 64 characters with no spaces');
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    if (origin === '*' || !/^https?:\/\/[^/\s]+$/.test(origin)) {
      problems.push('ALLOWED_ORIGINS must be a comma-separated list of exact origins, no wildcard');
      break;
    }
  }

  let sheets: AppConfig['sheets'] = null;
  if (dataSource === 'sheets') {
    const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? '';
    const sheetId = env.GOOGLE_SHEET_ID?.trim() ?? '';
    if (!serviceAccountJson)
      problems.push('GOOGLE_SERVICE_ACCOUNT_JSON is required for DATA_SOURCE=sheets');
    if (!sheetId) {
      problems.push('GOOGLE_SHEET_ID is required for DATA_SOURCE=sheets');
    } else if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) {
      problems.push('GOOGLE_SHEET_ID is not a valid spreadsheet ID');
    }
    sheets = {
      serviceAccountJson,
      sheetId,
      tab: env.GOOGLE_SHEET_TAB?.trim() || 'Orders',
      timeoutMs: int(env, 'SHEETS_TIMEOUT_MS', 1500, 200, 10_000, problems),
      retries: int(env, 'SHEETS_MAX_RETRIES', 1, 0, 3, problems),
      backoffMs: int(env, 'SHEETS_BACKOFF_MS', 100, 10, 2000, problems),
      cacheTtlMs: int(env, 'SHEETS_CACHE_TTL_MS', 15_000, 0, 300_000, problems),
    };
  }

  let supabase: AppConfig['supabase'] = null;
  if (dataSource === 'supabase') {
    const url = (env.SUPABASE_URL?.trim() ?? '').replace(/\/+$/, '');
    // SUPABASE_SECRET_KEY is the newer name for the same server-only key.
    const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '').trim();
    const table = env.SUPABASE_TABLE?.trim() || 'orders';
    if (!url) {
      problems.push('SUPABASE_URL is required for DATA_SOURCE=supabase');
    } else if (
      !/^https:\/\/[^/\s]+$/.test(url) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)
    ) {
      problems.push('SUPABASE_URL must be the project URL, e.g. https://abcd1234.supabase.co');
    }
    if (!serviceKey) {
      problems.push('SUPABASE_SERVICE_ROLE_KEY is required for DATA_SOURCE=supabase');
    } else if (serviceKey.startsWith('sb_publishable_')) {
      problems.push('SUPABASE_SERVICE_ROLE_KEY must be the secret key, not the publishable key');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table)) {
      problems.push('SUPABASE_TABLE must be a plain table name');
    }
    supabase = {
      url,
      serviceKey,
      table,
      timeoutMs: int(env, 'SUPABASE_TIMEOUT_MS', 2000, 200, 10_000, problems),
      retries: int(env, 'SUPABASE_MAX_RETRIES', 1, 0, 3, problems),
      backoffMs: int(env, 'SUPABASE_BACKOFF_MS', 100, 10, 2000, problems),
    };
  }

  const businessTimeZone = env.BUSINESS_TIMEZONE?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: businessTimeZone });
  } catch {
    problems.push('BUSINESS_TIMEZONE must be an IANA time zone such as "Asia/Karachi"');
  }

  const currency = env.CURRENCY_LABEL?.trim() || 'PKR';
  if (!/^[A-Za-z ]{1,20}$/.test(currency)) problems.push('CURRENCY_LABEL must be letters only');

  const config: AppConfig = {
    production,
    dataSource,
    retellApiKey,
    retellAgentId,
    webCallPasscode,
    webCall: {
      windowMs: int(env, 'WEB_CALL_RATE_LIMIT_WINDOW_MS', 600_000, 1000, 86_400_000, problems),
      maxPerIp: int(env, 'WEB_CALL_MAX_PER_IP', 5, 1, 10_000, problems),
      maxGlobal: int(env, 'WEB_CALL_MAX_GLOBAL', 40, 1, 100_000, problems),
    },
    allowedOrigins,
    maxBodyBytes: int(env, 'MAX_BODY_BYTES', 102_400, 1024, 1_048_576, problems),
    rateLimit: {
      windowMs: int(env, 'RATE_LIMIT_WINDOW_MS', 60_000, 1000, 3_600_000, problems),
      maxPerIp: int(env, 'RATE_LIMIT_MAX_PER_IP', 120, 1, 100_000, problems),
      maxPerCall: int(env, 'RATE_LIMIT_MAX_PER_CALL', 20, 1, 100_000, problems),
    },
    businessTimeZone,
    currency,
    sheets,
    supabase,
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
