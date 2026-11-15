import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../lib/config.js';
import { DemoOrderRepository } from '../lib/data/demo-repository.js';
import { createRepository } from '../lib/data/index.js';
import { API_KEY } from './helpers.js';

const SHEETS = {
  RETELL_API_KEY: API_KEY,
  DATA_SOURCE: 'sheets',
  GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b.test","private_key":"k"}',
  GOOGLE_SHEET_ID: 'sheet_id_for_tests_only_0000',
};

function problems(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('configuration', () => {
  it('defaults to the demo data source so a deployment never touches real data', () => {
    const config = loadConfig({ RETELL_API_KEY: API_KEY });
    expect(config).toMatchObject({ dataSource: 'demo', sheets: null, production: false });
    expect(createRepository(config)).toBeInstanceOf(DemoOrderRepository);
    expect(config.allowedOrigins).toEqual([]);
    expect(loadConfig({ RETELL_API_KEY: API_KEY, DATA_SOURCE: '' }).dataSource).toBe('demo');
  });

  it('fails fast without the Retell API key, in every environment', () => {
    expect(problems({})).toContain('RETELL_API_KEY is required');
    expect(problems({ VERCEL_ENV: 'production' })).toContain('RETELL_API_KEY is required');
    expect(problems({ VERCEL_ENV: 'preview', RETELL_API_KEY: '  ' })).toHaveLength(1);
  });

  it('rejects a placeholder key in production', () => {
    for (const key of ['replace-with-your-retell-key', 'test', 'short']) {
      expect(problems({ NODE_ENV: 'production', RETELL_API_KEY: key })).toContain(
        'RETELL_API_KEY looks like a placeholder',
      );
    }
    expect(problems({ VERCEL_ENV: 'production', RETELL_API_KEY: API_KEY })).toEqual([]);
  });

  it('requires the Google variables when DATA_SOURCE=sheets', () => {
    const found = problems({ RETELL_API_KEY: API_KEY, DATA_SOURCE: 'sheets' });
    expect(found).toContain('GOOGLE_SERVICE_ACCOUNT_JSON is required for DATA_SOURCE=sheets');
    expect(found).toContain('GOOGLE_SHEET_ID is required for DATA_SOURCE=sheets');
    expect(loadConfig(SHEETS).sheets).toMatchObject({ tab: 'Orders', timeoutMs: 1500, retries: 1 });
  });

  it('reports every problem at once and never includes values', () => {
    const secret = 'super-secret-value-123';
    const found = problems({
      RETELL_API_KEY: secret,
      VERCEL_ENV: 'production',
      DATA_SOURCE: 'postgres',
      ALLOWED_ORIGINS: '*',
      RATE_LIMIT_MAX_PER_IP: 'lots',
      BUSINESS_TIMEZONE: 'Mars/Olympus',
      GOOGLE_SHEET_ID: secret,
    });
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found.join(' ')).not.toContain(secret);
    expect(new ConfigError(found).message).not.toContain(secret);
  });

  it('accepts only exact origins', () => {
    const config = loadConfig({
      RETELL_API_KEY: API_KEY,
      ALLOWED_ORIGINS: 'https://lumina.example.test/, http://localhost:5173',
    });
    expect(config.allowedOrigins).toEqual(['https://lumina.example.test', 'http://localhost:5173']);
    expect(
      problems({ RETELL_API_KEY: API_KEY, ALLOWED_ORIGINS: 'lumina.example.test' }),
    ).toHaveLength(1);
  });

  it('reads tunables within bounds', () => {
    const config = loadConfig({
      ...SHEETS,
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX_PER_IP: '50',
      RATE_LIMIT_MAX_PER_CALL: '5',
      MAX_BODY_BYTES: '2048',
      SHEETS_CACHE_TTL_MS: '0',
      BUSINESS_TIMEZONE: 'Asia/Karachi',
      CURRENCY_LABEL: 'rupees',
    });
    expect(config.rateLimit).toEqual({ windowMs: 30_000, maxPerIp: 50, maxPerCall: 5 });
    expect(config).toMatchObject({
      maxBodyBytes: 2048,
      businessTimeZone: 'Asia/Karachi',
      currency: 'rupees',
    });
    expect(config.sheets?.cacheTtlMs).toBe(0);
    expect(problems({ RETELL_API_KEY: API_KEY, MAX_BODY_BYTES: '5' })).toHaveLength(1);
  });
});
