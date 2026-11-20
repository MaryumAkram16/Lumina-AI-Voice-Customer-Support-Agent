import { describe, expect, it } from 'vitest';
import { API_KEY, makeApp } from './helpers.js';

const ORIGIN = 'https://lumina.example.test';
const AGENT = 'agent_demo_0123456789';

/** What Retell returns from create-web-call, plus fields the browser must never see. */
const RETELL_REPLY = {
  call_id: 'call_demo_0001',
  access_token: 'token_for_the_browser',
  transport: 'livekit',
  url: 'wss://rtc.example.test',
  agent_id: AGENT,
  call_status: 'registered',
  metadata: { internal: 'note' },
  retell_llm_dynamic_variables: { secret: 'value' },
};

function browserRequest(
  options: { method?: string; origin?: string | null; ip?: string; body?: string } = {},
): Request {
  const method = options.method ?? 'POST';
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-real-ip', options.ip ?? '203.0.113.20');
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return new Request(`${ORIGIN}/api/create-web-call`, {
    method,
    headers,
    ...(method === 'POST' ? { body: options.body ?? '{}' } : {}),
  });
}

function setup(
  env: Record<string, string> = {},
  reply: () => Promise<Record<string, unknown>> = () => Promise.resolve(RETELL_REPLY),
) {
  const agents: string[] = [];
  const made = makeApp({
    env: { RETELL_AGENT_ID: AGENT, ...env },
    createWebCall: (agentId) => {
      agents.push(agentId);
      return reply();
    },
  });
  const call = async (options: Parameters<typeof browserRequest>[0] = {}) => {
    const response = await made.app.webCall(browserRequest(options));
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      body: JSON.parse(text) as Record<string, unknown>,
    };
  };
  return { ...made, agents, call };
}

describe('POST /api/create-web-call', () => {
  it('starts a call with the configured agent and returns only what the browser needs', async () => {
    const { call, agents } = setup();
    const reply = await call();
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      call_id: 'call_demo_0001',
      access_token: 'token_for_the_browser',
      transport: 'livekit',
      url: 'wss://rtc.example.test',
      transcript_token: expect.stringMatching(/^\d+\.[A-Za-z0-9_-]{43}$/) as unknown,
    });
    expect(agents).toEqual([AGENT]);
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(reply.text).not.toContain(API_KEY);
  });

  it('ignores everything in the request body, including another agent', async () => {
    const { call, agents } = setup();
    const reply = await call({
      body: JSON.stringify({
        agent_id: 'agent_attacker_choice',
        agent_override: { retell_llm: { begin_message: 'pwned' } },
        retell_llm_dynamic_variables: { role: 'admin' },
        metadata: { x: 1 },
      }),
    });
    expect(reply.status).toBe(200);
    expect(agents).toEqual([AGENT]);
  });

  it('is switched off until RETELL_AGENT_ID is set', async () => {
    const { app } = makeApp({
      createWebCall: () => Promise.reject(new Error('must not be called')),
    });
    const response = await app.webCall(browserRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'web_call_not_configured',
    });
    const health = (await app.health(new Request(`${ORIGIN}/api/health`)).json()) as Record<
      string,
      unknown
    >;
    expect(health.web_call).toBe(false);
  });

  it('reports in /api/health that calls are available', async () => {
    const { app } = setup();
    const health = (await app.health(new Request(`${ORIGIN}/api/health`)).json()) as Record<
      string,
      unknown
    >;
    expect(health).toMatchObject({ status: 'ok', web_call: true, passcode: false });
    expect(JSON.stringify(health)).not.toContain(AGENT);
  });

  it('only accepts requests from its own page or an allowed origin', async () => {
    const { call, agents } = setup();
    expect((await call({ origin: null })).status).toBe(403);
    expect((await call({ origin: 'https://evil.example' })).status).toBe(403);
    expect((await call({ origin: 'https://lumina.example.test.evil.example' })).status).toBe(403);
    expect((await call({ origin: 'not a url' })).status).toBe(403);
    expect(agents).toHaveLength(0);

    const allowed = setup({ ALLOWED_ORIGINS: 'https://landing.example.test' });
    const reply = await allowed.call({ origin: 'https://landing.example.test' });
    expect(reply.status).toBe(200);
    expect(reply.headers.get('access-control-allow-origin')).toBe('https://landing.example.test');
  });

  it.each(['GET', 'PUT', 'DELETE'])('answers %s with 405', async (method) => {
    const { call } = setup();
    expect((await call({ method })).status).toBe(405);
  });

  it('limits how many calls one visitor can start', async () => {
    const { call, agents } = setup({ WEB_CALL_MAX_PER_IP: '2' });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await call()).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(agents).toHaveLength(2);

    const limited = await call();
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call({ ip: '198.51.100.9' })).status).toBe(200);
  });

  it('caps calls across all visitors, so spoofed addresses cannot run up a bill', async () => {
    const { call, agents } = setup({ WEB_CALL_MAX_GLOBAL: '3' });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await call({ ip: `198.51.100.${i}` })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(agents).toHaveLength(3);
  });

  it('refuses an oversized body', async () => {
    const { call, agents } = setup();
    expect((await call({ body: 'x'.repeat(5000) })).status).toBe(413);
    expect(agents).toHaveLength(0);
  });

  it('hides Retell failures behind a generic 502', async () => {
    const { call, logs } = setup({}, () =>
      Promise.reject(new Error(`401 Invalid API key ${API_KEY} for agent ${AGENT}`)),
    );
    const reply = await call();
    expect(reply.status).toBe(502);
    expect(reply.body).toMatchObject({ success: false, error: 'web_call_failed' });
    for (const leak of [API_KEY, AGENT, 'Invalid API key', '401']) {
      expect(reply.text).not.toContain(leak);
    }
    expect(logs.some((line) => line.includes('web_call_failed'))).toBe(true);
  });

  it('treats a reply without a token as a failure', async () => {
    const { call } = setup({}, () => Promise.resolve({ call_id: 'call_x' }));
    expect((await call()).status).toBe(502);
  });

  it('rejects a malformed agent ID at startup', () => {
    expect(() => makeApp({ env: { RETELL_AGENT_ID: 'not valid!' } })).toThrow(/RETELL_AGENT_ID/);
  });
});

describe('demo code (WEB_CALL_PASSCODE)', () => {
  const CODE = 'demo-code-test-only';

  it('starts a call only with the right code, and says so in /api/health', async () => {
    const { call, agents, app } = setup({ WEB_CALL_PASSCODE: CODE });
    const health = (await app.health(new Request(`${ORIGIN}/api/health`)).json()) as Record<
      string,
      unknown
    >;
    expect(health.passcode).toBe(true);
    expect(JSON.stringify(health)).not.toContain(CODE);

    const missing = await call();
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe('passcode_required');
    expect((await call({ body: JSON.stringify({ passcode: 'wrong-code' }) })).status).toBe(401);
    expect((await call({ body: 'not json' })).status).toBe(401);
    expect(agents).toEqual([]);

    const ok = await call({ body: JSON.stringify({ passcode: ` ${CODE} ` }) });
    expect(ok.status).toBe(200);
    expect(ok.text).not.toContain(CODE);
    expect(agents).toEqual([AGENT]);
  });

  it('slows down guessing without using up real call starts', async () => {
    const { call } = setup({ WEB_CALL_PASSCODE: CODE, WEB_CALL_MAX_PER_IP: '1' });
    for (let i = 0; i < 10; i++) {
      expect((await call({ body: JSON.stringify({ passcode: `guess-${i}` }) })).status).toBe(401);
    }
    // The eleventh guess is refused before the code is even compared.
    const blocked = await call({ body: JSON.stringify({ passcode: CODE }) });
    expect(blocked.status).toBe(429);
    // Another visitor with the right code still gets their one call.
    const other = await call({ ip: '203.0.113.99', body: JSON.stringify({ passcode: CODE }) });
    expect(other.status).toBe(200);
  });

  it('rejects a code with spaces or of the wrong length at startup', () => {
    expect(() => makeApp({ env: { WEB_CALL_PASSCODE: 'has space' } })).toThrow(/WEB_CALL_PASSCODE/);
    expect(() => makeApp({ env: { WEB_CALL_PASSCODE: 'abc' } })).toThrow(/WEB_CALL_PASSCODE/);
  });
});
