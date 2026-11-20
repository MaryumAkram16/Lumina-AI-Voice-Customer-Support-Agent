import './styles.css';
import type { ActiveCall } from './call.js';
import {
  describeEnd,
  describeError,
  formatDuration,
  levelOf,
  PROMPTS,
  viewFor,
  type CallState,
  type TranscriptLine,
} from './state.js';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

function button(id: string): HTMLButtonElement {
  const node = el(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return node;
}

function input(id: string): HTMLInputElement {
  const node = el(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return node;
}

const consoleEl = el('console');
const orb = el('orb');
const statusEl = el('status');
const detailEl = el('detail');
const timerEl = el('timer');
const startBtn = button('start');
const muteBtn = button('mute');
const endBtn = button('end');
const backendEl = el('backend');
const backendText = el('backend-text');
const heroStartBtn = button('hero-start');
const linesEl = el('lines');
const transcriptEmpty = el('transcript-empty');
const passcodeRow = el('passcode-row');
const passcodeInput = input('passcode');

const CODE_KEY = 'lumina-demo-code';
let passcodeRequired = false;

/** A code in the shared link (?code=...) fills the field, then leaves the address bar. */
function takeCodeFromLink(): void {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code')?.trim();
  if (code) {
    passcodeInput.value = code;
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } else {
    try {
      passcodeInput.value = window.sessionStorage.getItem(CODE_KEY) ?? '';
    } catch {
      // Storage can be blocked; the visitor just types the code again.
    }
  }
}

function rememberCode(code: string): void {
  try {
    if (code) window.sessionStorage.setItem(CODE_KEY, code);
    else window.sessionStorage.removeItem(CODE_KEY);
  } catch {
    // Not important if storage is blocked.
  }
}

// The call library is large, so it loads in the background after the page
// paints. By the time someone presses start it is normally already here.
const callModule = import('./call.js');

let call: ActiveCall | null = null;
let starting = false;
let muted = false;
let startedAt = 0;
let ticker: number | undefined;

function render(state: CallState, detail = ''): void {
  const view = viewFor(state, detail);
  consoleEl.dataset.state = state;
  statusEl.textContent = view.status;
  detailEl.textContent = view.detail;
  startBtn.hidden = view.start === null;
  startBtn.textContent = view.start ?? '';
  startBtn.disabled = view.startDisabled;
  muteBtn.hidden = !view.inCall || state === 'connecting';
  endBtn.hidden = !view.inCall;
  endBtn.textContent = state === 'connecting' ? 'Cancel' : 'End call';
  if (state !== 'live') orb.style.setProperty('--level', '0');
}

/** Redraws the transcript, staying pinned to the newest line unless the visitor scrolled up. */
function renderTranscript(lines: readonly TranscriptLine[]): void {
  const pinned = linesEl.scrollHeight - linesEl.scrollTop - linesEl.clientHeight < 40;
  linesEl.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement('li');
      item.className = `line line-${line.speaker}`;
      const who = document.createElement('span');
      who.className = 'line-who';
      who.textContent = line.speaker === 'lumina' ? 'Lumina' : 'You';
      const text = document.createElement('p');
      text.textContent = line.text;
      item.append(who, text);
      return item;
    }),
  );
  transcriptEmpty.hidden = lines.length > 0;
  if (pinned) linesEl.scrollTop = linesEl.scrollHeight;
}

function stopTimer(): void {
  window.clearInterval(ticker);
  ticker = undefined;
}

function setMuted(next: boolean): void {
  muted = next;
  call?.setMuted(muted);
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-pressed', String(muted));
  if (consoleEl.dataset.state === 'live') {
    detailEl.textContent = muted
      ? 'You are muted. Lumina cannot hear you.'
      : viewFor('live').detail;
  }
}

startBtn.addEventListener('click', () => {
  if (call || starting) return;
  const code = passcodeInput.value.trim();
  if (passcodeRequired && !code) {
    detailEl.textContent = 'Enter your demo code first.';
    passcodeInput.focus();
    return;
  }
  rememberCode(code);
  starting = true;
  render('connecting');
  renderTranscript([]);
  timerEl.textContent = '00:00';
  callModule
    .then(({ startCall }) => {
      call = startCall(
        {
          onLive() {
            render('live');
            setMuted(false);
            startedAt = Date.now();
            ticker = window.setInterval(() => {
              timerEl.textContent = formatDuration((Date.now() - startedAt) / 1000);
            }, 500);
          },
          onEnded(reason) {
            call = null;
            stopTimer();
            render('ended', describeEnd(reason));
          },
          onError(error) {
            call = null;
            stopTimer();
            if (
              typeof error === 'object' &&
              error !== null &&
              'status' in error &&
              error.status === 401
            ) {
              rememberCode('');
              passcodeInput.select();
            }
            render('error', describeError(error));
          },
          onTranscript(lines) {
            renderTranscript(lines);
          },
          onLevel(samples) {
            orb.style.setProperty('--level', levelOf(samples).toFixed(3));
          },
        },
        code,
      );
    })
    .catch((error: unknown) => {
      render('error', describeError(error));
    })
    .finally(() => {
      starting = false;
    });
});

// The hero button starts the same call and brings the mic panel into view.
heroStartBtn.addEventListener('click', () => {
  consoleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!startBtn.hidden && !startBtn.disabled) startBtn.click();
});

muteBtn.addEventListener('click', () => {
  setMuted(!muted);
});

endBtn.addEventListener('click', () => {
  call?.end();
});

// Hang up rather than leave a call running when the tab is closed.
window.addEventListener('pagehide', () => {
  call?.end();
});

function renderPrompts(): void {
  const list = el('cards');
  for (const prompt of PROMPTS) {
    const item = document.createElement('li');
    item.className = 'card';

    const action = document.createElement('p');
    action.className = 'card-action';
    action.textContent = prompt.action;

    const say = document.createElement('p');
    say.className = 'card-say';
    // Keep each order number on one line.
    for (const part of `“${prompt.say}”`.split(/(ORD-TEST-\d{3})/)) {
      if (part.startsWith('ORD-TEST-')) {
        const id = document.createElement('span');
        id.className = 'nowrap';
        id.textContent = part;
        say.append(id);
      } else {
        say.append(part);
      }
    }

    item.append(action, say);

    if (prompt.email) {
      const email = document.createElement('p');
      email.className = 'card-email';
      const label = document.createElement('span');
      label.textContent = 'Email on the order';
      const value = document.createElement('code');
      value.textContent = prompt.email;
      email.append(label, value);
      item.append(email);
    }

    const outcome = document.createElement('p');
    outcome.className = 'card-outcome';
    outcome.textContent = prompt.outcome;
    item.append(outcome);

    list.append(item);
  }
}

interface Health {
  status?: string;
  data_source?: string;
  web_call?: boolean;
  passcode?: boolean;
}

async function checkBackend(): Promise<void> {
  try {
    const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
    const health = (await response.json()) as Health;
    if (!response.ok || health.status !== 'ok') throw new Error('unhealthy');

    backendEl.dataset.state = 'ok';
    backendText.textContent = 'Lumina is online';
    passcodeRequired = health.passcode === true;
    passcodeRow.hidden = !passcodeRequired;
    if (health.web_call !== true) render('unavailable');
  } catch {
    backendEl.dataset.state = 'down';
    backendText.textContent = 'Line unavailable';
    render('unavailable', "Lumina isn't answering right now. Please try again in a little while.");
  }
}

takeCodeFromLink();
renderPrompts();
render('idle');
void checkBackend();
