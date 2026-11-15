/**
 * Text hygiene helpers: what may be spoken, what may be written to a sheet,
 * and what may appear in a log line.
 */

const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]',
  'g',
);

/** Characters that make a spreadsheet treat a cell as a formula (OWASP CSV injection). */
const FORMULA_TRIGGER = /^[=+\-@\t\r|]/;

/**
 * Make a value safe to write into a spreadsheet cell.
 *
 * Writes also use `valueInputOption=RAW`, so Sheets never parses the value;
 * the leading apostrophe additionally protects anyone who later exports the
 * sheet to CSV and opens it in another spreadsheet program.
 */
export function guardFormula(value: string, maxLength = 500): string {
  const cleaned = value.replace(CONTROL_CHARS, ' ').trim().slice(0, maxLength);
  // Also catch a trigger hidden behind leading whitespace or quotes.
  const probe = cleaned.replace(/^[\s'"]+/, '');
  return FORMULA_TRIGGER.test(cleaned) || FORMULA_TRIGGER.test(probe) ? `'${cleaned}` : cleaned;
}

/**
 * Make data-source text safe to hand to a voice agent: no control characters,
 * no markdown, no markup, no URLs, bounded length. Order data is written by
 * people, so it is treated as untrusted too.
 */
export function speakable(value: string | null | undefined, maxLength = 80): string {
  if (!value) return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[<>{}[\]`*_#|~^\\$=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${email.slice(0, 1)}***@${domain.slice(0, 1)}***${tld}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-2)}` : '***';
}

export function maskOrderId(orderId: string): string {
  return orderId.length > 3 ? `***${orderId.slice(-3)}` : '***';
}

export function maskName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed.slice(0, 1)}***` : '***';
}

/** Digits only, for comparing phone numbers written in different styles. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}
