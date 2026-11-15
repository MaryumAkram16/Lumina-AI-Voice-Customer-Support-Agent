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
  dataSource: 'demo' | 'sheets';
  retellApiKey: string;
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
  if (dataSourceRaw !== 'demo' && dataSourceRaw !== 'sheets') {
    problems.push('DATA_SOURCE must be "demo" or "sheets"');
  }
  const dataSource = dataSourceRaw === 'sheets' ? 'sheets' : 'demo';

  // Required everywhere, not only in production: without it requests cannot
  // be verified, and Vercel preview deployments are public URLs too.
  const retellApiKey = env.RETELL_API_KEY?.trim() ?? '';
  if (!retellApiKey) {
    problems.push('RETELL_API_KEY is required');
  } else if (production && (retellApiKey.length < 16 || PLACEHOLDER.test(retellApiKey))) {
    problems.push('RETELL_API_KEY looks like a placeholder');
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
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
