/**
 * Pure view logic for the Talk to Lumina page: no DOM, no network. What the console
 * shows in each state, how errors are worded, and the demo prompts.
 */

export type CallState = 'unavailable' | 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface View {
  status: string;
  detail: string;
  /** Label of the start button, or null when it is hidden. */
  start: string | null;
  startDisabled: boolean;
  /** Whether the mute and end buttons are shown. */
  inCall: boolean;
}

export function viewFor(state: CallState, detail = ''): View {
  switch (state) {
    case 'unavailable':
      return {
        status: 'Lumina is offline',
        detail: detail || 'Voice calls are not switched on right now. Please check back soon.',
        start: 'Start call',
        startDisabled: true,
        inCall: false,
      };
    case 'idle':
      return {
        status: 'Ready when you are',
        detail: 'Press start, then just speak.',
        start: 'Start call',
        startDisabled: false,
        inCall: false,
      };
    case 'connecting':
      return {
        status: 'Connecting',
        detail: 'Allow the microphone if your browser asks.',
        start: null,
        startDisabled: true,
        inCall: true,
      };
    case 'live':
      return {
        status: 'Lumina is on the line',
        detail: detail || 'Go ahead, ask about an order.',
        start: null,
        startDisabled: true,
        inCall: true,
      };
    case 'ended':
      return {
        status: 'Call ended',
        detail: detail || 'Thanks for trying Lumina.',
        start: 'Call again',
        startDisabled: false,
        inCall: false,
      };
    case 'error':
      return {
        status: "Couldn't connect",
        detail: detail || 'Something went wrong. Please try again.',
        start: 'Try again',
        startDisabled: false,
        inCall: false,
      };
  }
}

/** Turns whatever the browser or the Retell client threw into one plain sentence. */
export function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;

  if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(message)) {
    return 'The microphone is blocked. Allow it for this site in your browser, then try again.';
  }
  if (name === 'NotFoundError' || /requested device not found|no microphone/i.test(message)) {
    return 'No microphone was found. Plug one in or check your sound settings.';
  }
  if (status === 429) return 'Too many calls were started from here. Try again in a few minutes.';
  if (status === 503) return 'Voice calls are not switched on right now. Please check back soon.';
  if (status === 403) return 'This page is not allowed to start calls. Please try again later.';
  if (status >= 500) return 'The voice service did not answer. Please try again in a moment.';
  if (name === 'TypeError' || /failed to fetch|network/i.test(message)) {
    return 'The connection dropped. Check your internet and try again.';
  }
  return 'Something went wrong starting the call. Please try again.';
}

/** Why Retell says the call ended, in words a visitor understands. */
export function describeEnd(reason: string | undefined): string {
  switch (reason) {
    case 'agent_hangup':
      return 'Lumina ended the call.';
    case 'inactivity':
      return 'The call ended because it went quiet.';
    case 'max_duration_reached':
      return 'The call reached its time limit.';
    case 'concurrency_limit_reached':
      return 'Too many calls are running right now. Try again shortly.';
    default:
      return reason?.startsWith('error') ? 'The call dropped. Please try again.' : '';
  }
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Loudness of one analyser frame, 0 to 1, shaped so quiet speech still shows. */
export function levelOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
}

export interface TranscriptLine {
  speaker: 'you' | 'lumina';
  text: string;
}

/**
 * Turns Retell's live transcript into the lines shown under the mic. Keeps only
 * what the caller and Lumina said (no tool calls, node changes or other
 * events), drops empty entries and backchannels like "mm-hmm", and joins
 * consecutive entries from the same speaker into one line.
 */
export function toTranscript(utterances: readonly unknown[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const utterance of utterances) {
    if (typeof utterance !== 'object' || utterance === null) continue;
    const { role, content, metadata } = utterance as {
      role?: unknown;
      content?: unknown;
      metadata?: { is_backchannel?: unknown };
    };
    if (role !== 'agent' && role !== 'user') continue;
    if (metadata?.is_backchannel === true) continue;
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) continue;
    const speaker = role === 'agent' ? 'lumina' : 'you';
    const last = lines.at(-1);
    if (last?.speaker === speaker) last.text = `${last.text} ${text}`;
    else lines.push({ speaker, text });
  }
  return lines;
}

export interface Prompt {
  action: string;
  say: string;
  /** Email on the order, when Lumina will ask for one. */
  email?: string;
  outcome: string;
}

/** Matches the synthetic orders in serverless/lib/data/demo-orders.ts. */
export const PROMPTS: readonly Prompt[] = [
  {
    action: 'Track',
    say: 'Where is my order? The order number is ORD-TEST-001.',
    outcome: 'Shipped with UPS, expected 31 December 2026.',
  },
  {
    action: 'Cancel',
    say: 'I want to cancel order ORD-TEST-004.',
    email: 'jordan@example.test',
    outcome: 'Still cancellable, so Lumina cancels it. Ask again and it is already cancelled.',
  },
  {
    action: 'Return',
    say: "I'd like to return order ORD-TEST-005. It's unopened, wrong colour.",
    email: 'casey@example.test',
    outcome: 'Delivered three days ago, inside the 14-day window, so the return starts.',
  },
  {
    action: 'Refund',
    say: 'Can I get a refund for order ORD-TEST-006?',
    email: 'riley@example.test',
    outcome: 'Return already started and unopened, so the refund goes ahead.',
  },
  {
    action: 'Refused',
    say: 'I want a refund for order ORD-TEST-008.',
    email: 'avery@example.test',
    outcome: 'Declined: the item was opened.',
  },
  {
    action: 'Not found',
    say: 'Track order ORD-TEST-999.',
    outcome: 'Lumina says it cannot find it, without making up a status.',
  },
];
