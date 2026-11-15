import { describe, expect, it } from 'vitest';
import { DEMO_ORDERS } from '../lib/data/demo-orders.js';
import {
  describeEnd,
  describeError,
  formatDuration,
  levelOf,
  PROMPTS,
  viewFor,
  type CallState,
} from '../web/src/state.js';

describe('demo page view logic', () => {
  it('shows the right controls in every state', () => {
    const states: CallState[] = ['unavailable', 'idle', 'connecting', 'live', 'ended', 'error'];
    const summary = Object.fromEntries(
      states.map((state) => {
        const view = viewFor(state);
        return [state, [view.start, view.startDisabled, view.inCall]];
      }),
    );
    expect(summary).toEqual({
      unavailable: ['Start call', true, false],
      idle: ['Start call', false, false],
      connecting: [null, true, true],
      live: [null, true, true],
      ended: ['Call again', false, false],
      error: ['Try again', false, false],
    });
    for (const state of states) {
      expect(viewFor(state).status).not.toBe('');
      expect(viewFor(state).detail).not.toBe('');
      expect(viewFor(state, 'custom detail').detail).toBe(
        state === 'idle' || state === 'connecting' ? viewFor(state).detail : 'custom detail',
      );
    }
  });

  it('explains errors in plain words without leaking details', () => {
    const named = (name: string, message = '') => Object.assign(new Error(message), { name });
    const http = (status: number) => Object.assign(new Error('raw upstream text'), { status });

    expect(describeError(named('NotAllowedError'))).toMatch(/microphone is blocked/i);
    expect(describeError(new Error('Permission denied'))).toMatch(/microphone is blocked/i);
    expect(describeError(named('NotFoundError'))).toMatch(/No microphone/);
    expect(describeError(http(429))).toMatch(/Too many calls/);
    expect(describeError(http(503))).toMatch(/not switched on/);
    expect(describeError(http(403))).toMatch(/not allowed/);
    expect(describeError(http(502))).toMatch(/did not answer/);
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/connection dropped/);
    for (const error of [http(400), new Error('boom at file.ts:1'), 'a string', null, undefined]) {
      const text = describeError(error);
      expect(text).toMatch(/Something went wrong/);
      expect(text).not.toMatch(/boom|upstream|file\.ts/);
    }
  });

  it('explains why a call ended', () => {
    expect(describeEnd('agent_hangup')).toBe('Lumina ended the call.');
    expect(describeEnd('inactivity')).toMatch(/quiet/);
    expect(describeEnd('max_duration_reached')).toMatch(/time limit/);
    expect(describeEnd('error_llm_websocket_open')).toMatch(/dropped/);
    expect(describeEnd('user_hangup')).toBe('');
    expect(describeEnd(undefined)).toBe('');
  });

  it('formats the call timer', () => {
    expect([0, 9.9, 61, 600, 3599, -5].map(formatDuration)).toEqual([
      '00:00',
      '00:09',
      '01:01',
      '10:00',
      '59:59',
      '00:00',
    ]);
  });

  it('turns audio samples into a 0 to 1 level', () => {
    expect(levelOf([])).toBe(0);
    expect(levelOf(new Float32Array(128))).toBe(0);
    const quiet = levelOf(new Float32Array(128).fill(0.01));
    const loud = levelOf(new Float32Array(128).fill(0.5));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(levelOf(new Float32Array(128).fill(1))).toBe(1);
  });

  it('only suggests orders and emails that exist in the demo data', () => {
    for (const prompt of PROMPTS) {
      const orderId = /ORD-TEST-\d{3}/.exec(prompt.say)?.[0];
      expect(orderId, prompt.say).toBeDefined();
      const order = DEMO_ORDERS.find((demo) => demo.order_id === orderId);
      if (prompt.action === 'Not found') {
        expect(order).toBeUndefined();
      } else {
        expect(order, prompt.say).toBeDefined();
        if (prompt.email) expect(order?.email).toBe(prompt.email);
      }
    }
  });
});
