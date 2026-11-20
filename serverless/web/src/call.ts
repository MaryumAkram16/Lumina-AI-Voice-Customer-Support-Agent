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
const serverSideFetch: typeof fetch = (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).pathname === '/v3/create-web-call') {
    return fetch('/api/create-web-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
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

/** Starts a call. Must run from a click, because the microphone prompt happens here. */
export function startCall(handlers: CallHandlers): ActiveCall {
  // The client reports a fatal failure as an `error` followed, in the same
  // tick, by `end`. An `error` with no `end` behind it is only a warning.
  let fatal: Error | undefined;
  let sawTranscript = false;

  const session: WebCallSession = client.createWebCall({
    // Ignored by the server, which uses the agent it is configured with.
    agent_id: 'chosen-by-the-server',
    audio: { emitRawAudioSamples: true },
    hooks: {
      onStatus: (status) => {
        if (status === 'live') handlers.onLive();
      },
      // Both hooks carry the full transcript so far. Newer Retell clients send
      // `onTranscript`; `onUpdate` is the older event and the fallback.
      onTranscript: (transcript) => {
        sawTranscript = true;
        handlers.onTranscript(toTranscript(transcript));
      },
      onUpdate: (event) => {
        if (!sawTranscript) handlers.onTranscript(toTranscript(event.transcript));
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
