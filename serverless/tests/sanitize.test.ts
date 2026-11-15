import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '../lib/logger.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { guardFormula, maskEmail, maskPhone, speakable } from '../lib/sanitize.js';

describe('spreadsheet formula guard', () => {
  it.each([
    '=SUM(A1:A9)',
    '+1+1',
    '-2+3',
    '@SUM(1)',
    "=cmd|' /C calc'!A0",
    '\t=1+1',
    '\r=1+1',
    '   =HYPERLINK("https://evil.example")',
    '"=1+1"',
    '|calc',
  ])('neutralizes %j', (value) => {
    const guarded = guardFormula(value);
    expect(guarded.startsWith("'")).toBe(true);
    expect(guarded).not.toMatch(/[\t\r\n]/);
  });

  it.each(['changed my mind', 'arrived damaged - box crushed', 'size 2 = too small', ''])(
    'leaves ordinary text %j alone',
    (value) => {
      expect(guardFormula(value)).toBe(value);
    },
  );

  it('stays inert when guarded twice, and is bounded', () => {
    expect(guardFormula(guardFormula('=1+1'))).toBe("''=1+1");
    expect(guardFormula('x'.repeat(2000)).length).toBe(500);
  });
});

describe('speakable text', () => {
  it('removes markup, links, control characters and excess length', () => {
    expect(speakable('**Bold** _name_ `code`')).toBe('Bold name code');
    expect(speakable('see https://evil.example/x now')).toBe('see now');
    expect(speakable('line one\nline\u0000two‮')).toBe('line one line two');
    expect(speakable('<b>UPS</b>')).toBe('b UPS /b');
    expect(speakable('x'.repeat(500)).length).toBe(80);
    expect(speakable(null)).toBe('');
  });
});

describe('log redaction', () => {
  it('masks contact details', () => {
    expect(maskEmail('alex@example.test')).toBe('a***@e***.test');
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskPhone('+1-555-0101')).toBe('***01');
    expect(maskPhone('12')).toBe('***');
  });

  it('masks by field name at any depth and never logs free text', () => {
    const entry = redact({
      email: 'alex@example.test',
      phone_no: '+1-555-0101',
      customer_name: 'Alex Example',
      order_id: 'ORD-TEST-001',
      user_message: 'my card number is 4111 1111 1111 1111',
      nested: { Phone_no: '+1-555-0101', reason: 'private reason' },
    });
    const text = JSON.stringify(entry);
    for (const secret of [
      'alex@',
      '555-0101',
      'Alex Example',
      'ORD-TEST',
      '4111',
      'private reason',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(entry).toMatchObject({ order_id: '***001', user_message: '[37 chars]' });
  });

  it('writes one JSON object per line with bound fields', () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line)).child({ request_id: 'req-1' });
    logger.log('info', 'request_completed', { status: 200, email: 'alex@example.test' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'info',
      event: 'request_completed',
      request_id: 'req-1',
      status: 200,
      email: 'a***@e***.test',
    });
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window, then recovers', () => {
    const limiter = new RateLimiter(60_000);
    const results = Array.from({ length: 4 }, () => limiter.check('ip:1', 3, 1000).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect(limiter.check('ip:1', 3, 1000).retryAfterSeconds).toBe(60);
    expect(limiter.check('ip:2', 3, 1000).allowed).toBe(true);
    expect(limiter.check('ip:1', 3, 61_001).allowed).toBe(true);
  });

  it('keeps memory bounded', () => {
    const limiter = new RateLimiter(60_000, 100);
    for (let i = 0; i < 1000; i++) limiter.check(`ip:${i}`, 1, 1000);
    expect(limiter.check('ip:new', 1, 1000).allowed).toBe(true);
  });
});
