import { RetellClient, type WebCallSession } from 'retell-client-js-sdk';
import { toTranscript, type TranscriptLine } from './state.js';

export interface CallHandlers {
  onLive(): void;
  onEnded(reason: string | undefined): void;
  onError(error: unknown): void;
  onLevel(samples: Float32Array): void;
  /** The whole conversation so far, each time it changes. */
  onTranscript(lines: TranscriptLine[]): void;
}

/**
 * The Retell client would normally send its key from the browser. Here it has
 * no key: its one request, "create a web call", is rerouted to this site's own
 * /api/create-web-call, which holds the key and picks the agent. Retell's
 * reply contains a short-lived token, and the client joins the call with it.
 */
/** Set from each create-web-call response: what the page needs to follow the transcript. */
let lastCall: { callId: string; token: string } | null = null;

const serverSideFetch: typeof fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).pathname === '/v3/create-web-call') {
    const response = await fetch('/api/create-web-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { call_id?: unknown; transcript_token?: unknown };
      lastCall =
        typeof body.call_id === 'string' && typeof body.transcript_token === 'string'
          ? { callId: body.call_id, token: body.transcript_token }
          : null;
    }
    return response;
  }
  // Nothing else is offered to the browser.
  return Promise.resolve(
    new Response(JSON.stringify({ message: 'Not available in this demo.' }), { status: 404 }),
  );
};

const client = new RetellClient({ key: 'held-on-the-server', fetch: serverSideFetch });

export interface ActiveCall {
  setMuted(muted: boolean): void;
  end(): void;
}

/**
 * Follows the call's live transcript through this site's /api/call-transcript,
 * which holds the Retell key and relays only what was said. EventSource
 * reconnects by itself whenever a stream reaches its lifetime; each new stream
 * starts with the whole transcript, so nothing is lost.
 */
function followTranscript(
  call: { callId: string; token: string },
  onLines: (lines: TranscriptLine[]) => void,
): () => void {
  const params = new URLSearchParams({ call_id: call.callId, token: call.token });
  const source = new EventSource(`/api/call-transcript?${params.toString()}`);
  const stop = () => {
    source.close();
  };
  source.addEventListener('transcript', (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { utterances?: unknown };
      onLines(toTranscript(Array.isArray(data.utterances) ? data.utterances : []));
    } catch {
      // Ignore a malformed event; the next one carries the whole transcript again.
    }
  });
  source.addEventListener('end', stop);
  source.addEventListener('unavailable', stop);
  return stop;
}

/** Starts a call. Must run from a click, because the microphone prompt happens here. */
export function startCall(handlers: CallHandlers): ActiveCall {
  // The client reports a fatal failure as an `error` followed, in the same
  // tick, by `end`. An `error` with no `end` behind it is only a warning.
  let fatal: Error | undefined;
  let stopTranscript = (): void => undefined;
  lastCall = null;

  const session: WebCallSession = client.createWebCall({
    // Ignored by the server, which uses the agent it is configured with.
    agent_id: 'chosen-by-the-server',
    audio: { emitRawAudioSamples: true },
    hooks: {
      onStatus: (status) => {
        if (status !== 'live') return;
        handlers.onLive();
        if (lastCall)
          stopTranscript = followTranscript(lastCall, (lines) => {
            handlers.onTranscript(lines);
          });
      },
      onAudio: (samples) => {
        handlers.onLevel(samples);
      },
      onError: (error) => {
        fatal = error;
        queueMicrotask(() => {
          fatal = undefined;
        });
      },
      onEnd: (event) => {
        // Give the last words a moment to arrive before the stream closes.
        window.setTimeout(() => {
          stopTranscript();
        }, 3000);
        if (fatal) handlers.onError(fatal);
        else handlers.onEnded(event.disconnection_reason);
      },
    },
  });

  // `ready` rejects for failures the hooks above have already reported.
  session.ready.catch(() => undefined);

  return {
    setMuted(muted) {
      if (muted) session.mute();
      else session.unmute();
    },
    end() {
      void session.end().catch(() => undefined);
    },
  };
}
