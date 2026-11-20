import { describe, expect, it } from 'vitest';
import {
  mergeUtterances,
  relayCallTranscript,
  signTranscriptToken,
  verifyTranscriptToken,
  type MonitorSocket,
  type Spoken,
} from '../lib/transcript.js';
import { API_KEY, makeApp, NOW } from './helpers.js';

const CALL = 'call_demo_0001';
const NOW_S = Math.floor(NOW.getTime() / 1000);

/** Stands in for Retell's monitor socket. */
class FakeSocket implements MonitorSocket {
  onmessage: MonitorSocket['onmessage'] = null;
  onclose: MonitorSocket['onclose'] = null;
  onerror: MonitorSocket['onerror'] = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  close() {
    this.closed = true;
  }
  send(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code: number) {
    this.onclose?.({ code });
  }
}

function fakeRetell() {
  const sockets: FakeSocket[] = [];
  const open = (url: string, protocols: string[]) => {
    const socket = new FakeSocket(url, protocols);
    sockets.push(socket);
    return socket;
  };
  return { sockets, open };
}

const UTTERANCES = [
  { id: 'u1', time_sec: 0, role: 'agent', content: 'Hi, this is Lumina.' },
  { id: 'u2', time_sec: 2, role: 'user', content: 'Where is my order?' },
  { id: 't1', time_sec: 3, role: 'tool_call_invocation', name: 'check_order', arguments: '{}' },
  { id: 't2', time_sec: 3, role: 'tool_call_result', content: '{"email":"secret@x.test"}' },
];

describe('transcript token', () => {
  it('is valid only for its call, its key and until it expires', () => {
    const token = signTranscriptToken(API_KEY, CALL, NOW_S);
    expect(verifyTranscriptToken(API_KEY, CALL, token, NOW_S)).toBe(true);
    expect(verifyTranscriptToken(API_KEY, 'call_someone_else', token, NOW_S)).toBe(false);
    expect(verifyTranscriptToken('key_test_other_deployment', CALL, token, NOW_S)).toBe(false);
    expect(verifyTranscriptToken(API_KEY, CALL, token, NOW_S + 3 * 60 * 60)).toBe(false);
    expect(token).not.toContain(API_KEY);
  });

  it('rejects malformed or missing tokens', () => {
    const [expires = ''] = signTranscriptToken(API_KEY, CALL, NOW_S).split('.');
    for (const bad of [null, '', 'abc', `${expires}.`, `${expires + '9'}.${'A'.repeat(43)}`]) {
      expect(verifyTranscriptToken(API_KEY, CALL, bad, NOW_S)).toBe(false);
    }
  });
});

describe('mergeUtterances', () => {
  it('keeps only spoken lines, in first-seen order, updating them by ID', () => {
    const seen = new Map<string, Spoken | null>();
    expect(mergeUtterances(seen, UTTERANCES)).toEqual([
      { role: 'agent', content: 'Hi, this is Lumina.' },
      { role: 'user', content: 'Where is my order?' },
    ]);
    const updated = mergeUtterances(seen, [
      { id: 'u1', role: 'agent', content: 'Hi, this is Lumina. How can I help?' },
      { id: 'u3', role: 'user', content: 'mm-hmm', metadata: { is_backchannel: true } },
    ]);
    expect(updated).toEqual([
      { role: 'agent', content: 'Hi, this is Lumina. How can I help?' },
      { role: 'user', content: 'Where is my order?' },
      { role: 'user', content: 'mm-hmm', metadata: { is_backchannel: true } },
    ]);
    expect(JSON.stringify(updated)).not.toContain('secret@x.test');
  });

  it('ignores anything that is not a list of objects', () => {
    const seen = new Map<string, Spoken | null>();
    expect(mergeUtterances(seen, 'nope')).toEqual([]);
    expect(mergeUtterances(seen, [null, 3, 'x'])).toEqual([]);
  });
});

describe('relayCallTranscript', () => {
  it('connects with the key as a subprotocol and relays transcript updates until the call ends', () => {
    const retell = fakeRetell();
    const seen: Spoken[][] = [];
    let ended = 0;
    relayCallTranscript(
      { apiKey: API_KEY, callId: CALL, open: retell.open },
      {
        onTranscript: (spoken) => seen.push(spoken),
        onEnd: () => ended++,
        onUnavailable: () => expect.unreachable(),
      },
    );
    const socket = retell.sockets[0];
    expect(socket?.url).toBe('wss://api.retellai.com/v2/monitor-call/call_demo_0001');
    expect(socket?.protocols).toEqual(['bearer', API_KEY]);
    socket?.send({ type: 'transcript_snapshot', transcripts: UTTERANCES.slice(0, 1) });
    socket?.send({ type: 'transcript_updated', transcripts: UTTERANCES.slice(1) });
    socket?.send({ type: 'call_ended' });
    expect(seen.map((s) => s.length)).toEqual([1, 2]);
    expect(ended).toBe(1);
    expect(socket?.closed).toBe(true);
  });

  it('retries while the call is not live yet, and gives up on a refusal', async () => {
    const retell = fakeRetell();
    const sleeps: number[] = [];
    const reasons: string[] = [];
    relayCallTranscript(
      {
        apiKey: API_KEY,
        callId: CALL,
        open: retell.open,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
      {
        onTranscript: () => undefined,
        onEnd: () => undefined,
        onUnavailable: (r) => reasons.push(r),
      },
    );
    retell.sockets[0]?.drop(4004);
    await Promise.resolve();
    await Promise.resolve();
    expect(retell.sockets).toHaveLength(2);
    retell.sockets[1]?.drop(4001);
    expect(reasons).toEqual(['monitor closed with code 4001']);
    expect(sleeps).toEqual([500]);
  });
});

describe('GET /api/call-transcript', () => {
  const ORIGIN = 'https://lumina.example.test';

  async function readEvents(response: Response): Promise<string> {
    return response.text();
  }

  it('refuses a request without a valid token for that call', () => {
    const { app } = makeApp();
    const token = signTranscriptToken(API_KEY, CALL, NOW_S);
    const bad = [
      `call_id=${CALL}`,
      `call_id=${CALL}&token=1.${'A'.repeat(43)}`,
      `call_id=call_other_000&token=${token}`,
      `call_id=${encodeURIComponent('../x')}&token=${token}`,
    ];
    for (const query of bad) {
      const response = app.transcript(new Request(`${ORIGIN}/api/call-transcript?${query}`));
      expect(response.status).toBe(403);
    }
    const post = app.transcript(
      new Request(`${ORIGIN}/api/call-transcript?call_id=${CALL}&token=${token}`, {
        method: 'POST',
      }),
    );
    expect(post.status).toBe(405);
  });

  it('streams only what was said, then an end event', async () => {
    const retell = fakeRetell();
    const { app } = makeApp({ openMonitorSocket: retell.open });
    const token = signTranscriptToken(API_KEY, CALL, NOW_S);
    const response = app.transcript(
      new Request(`${ORIGIN}/api/call-transcript?call_id=${CALL}&token=${token}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const socket = retell.sockets[0];
    socket?.send({ type: 'transcript_snapshot', transcripts: UTTERANCES });
    socket?.send({ type: 'call_ended' });
    const text = await readEvents(response);
    expect(text).toContain('retry: 500');
    expect(text).toContain('event: transcript');
    expect(text).toContain('Where is my order?');
    expect(text).toContain('event: end');
    expect(text).not.toContain('secret@x.test');
    expect(text).not.toContain('check_order');
    expect(text).not.toContain(API_KEY);
  });

  it('tells the page when Retell refuses the stream', async () => {
    const retell = fakeRetell();
    const { app, logs } = makeApp({ openMonitorSocket: retell.open });
    const token = signTranscriptToken(API_KEY, CALL, NOW_S);
    const response = app.transcript(
      new Request(`${ORIGIN}/api/call-transcript?call_id=${CALL}&token=${token}`),
    );
    retell.sockets[0]?.drop(4003);
    expect(await readEvents(response)).toContain('event: unavailable');
    expect(logs.join('\n')).toContain('transcript_unavailable');
  });

  it('closes the stream at its lifetime so the browser reconnects', async () => {
    const retell = fakeRetell();
    const { app } = makeApp({ openMonitorSocket: retell.open, transcriptStreamMs: 20 });
    const token = signTranscriptToken(API_KEY, CALL, NOW_S);
    const response = app.transcript(
      new Request(`${ORIGIN}/api/call-transcript?call_id=${CALL}&token=${token}`),
    );
    const text = await readEvents(response);
    expect(text).not.toContain('event: end');
    expect(retell.sockets[0]?.closed).toBe(true);
  });
});
