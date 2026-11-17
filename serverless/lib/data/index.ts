import type { AppConfig } from '../config.js';
import { DemoOrderRepository } from './demo-repository.js';
import { GoogleTokenProvider, parseServiceAccount } from './google-auth.js';
import { SheetsOrderRepository } from './sheets-repository.js';
import { SupabaseOrderRepository } from './supabase-repository.js';
import type { OrderRepository } from './types.js';

/** Picks the data adapter from configuration (`DATA_SOURCE`). */
export function createRepository(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): OrderRepository {
  if (config.dataSource === 'sheets' && config.sheets) {
    const { serviceAccountJson, ...options } = config.sheets;
    const tokens = new GoogleTokenProvider(
      parseServiceAccount(serviceAccountJson),
      fetchImpl,
      options.timeoutMs,
    );
    return new SheetsOrderRepository(options, { fetchImpl, tokens });
  }
  if (config.dataSource === 'supabase' && config.supabase) {
    return new SupabaseOrderRepository(config.supabase, { fetchImpl });
  }
  return new DemoOrderRepository();
}
