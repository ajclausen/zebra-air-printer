/**
 * {{variable}} syntax used in text and barcode data.
 *
 *   {{Name}}               custom field, filled in at print time
 *   {{date}}               today, e.g. "Sep 25, 2026"
 *   {{date+7}}             seven days from today (negative offsets work too)
 *   {{date:YYYY-MM-DD}}    custom format (tokens below), combinable: {{date+30:MMM D}}
 *   {{time}}               current time, e.g. "3:05 PM"; {{time:HH:mm}} for a custom format
 *   {{counter}}            the batch sequence value
 *
 * Format tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A
 */

const VARIABLE_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

type BuiltIn = { kind: 'date'; offsetDays: number; format: string | null } | { kind: 'time'; format: string | null } | { kind: 'counter' };

/** Built-ins are lowercase only, so custom fields may be called "Date", "Time", or "Counter". */
const BUILT_IN_PATTERN = /^(date|time|counter)\s*(?:([+-])\s*(\d+))?\s*(?::(.*))?$/;

/** Parse a variable body (the text between the braces) as a built-in, or null for a custom field. */
export function parseBuiltIn(body: string): BuiltIn | null {
  const match = BUILT_IN_PATTERN.exec(body.trim());
  if (!match) return null;
  const name = match[1]!;
  const format = match[4]?.trim() || null;
  if (name === 'date') {
    const offset = match[3] ? Number(match[3]) * (match[2] === '-' ? -1 : 1) : 0;
    return { kind: 'date', offsetDays: offset, format };
  }
  if (match[2]) return null; // offsets only apply to dates
  if (name === 'time') return { kind: 'time', format };
  if (format) return null;
  return { kind: 'counter' };
}

export function isBuiltInVariable(body: string): boolean {
  return parseBuiltIn(body) !== null;
}

/** Custom field keys in order of first appearance, de-duplicated. */
export function extractFieldKeys(texts: Iterable<string>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      const key = match[1]!.trim();
      if (!key || isBuiltInVariable(key) || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** True when any text uses {{counter}}. */
export function usesCounter(texts: Iterable<string>): boolean {
  for (const text of texts) {
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      if (parseBuiltIn(match[1]!)?.kind === 'counter') return true;
    }
  }
  return false;
}

/** Non-global twin of VARIABLE_PATTERN: `.test()` on a global regex leaves lastIndex set, which later `matchAll` calls inherit. */
const HAS_VARIABLE = /\{\{\s*[^{}]*?\s*\}\}/;

export function hasVariables(text: string): boolean {
  return HAS_VARIABLE.test(text);
}

export interface SubstitutionContext {
  values: Record<string, string>;
  counter: string;
  now: Date;
  /** BCP 47 locale for default date/time formats. Defaults to the browser's. */
  locale?: string;
}

/** Replace every {{variable}} in `text`. Unknown custom fields become empty strings. */
export function substitute(text: string, ctx: SubstitutionContext): string {
  return text.replace(VARIABLE_PATTERN, (_whole, rawBody: string) => {
    const body = rawBody.trim();
    const builtIn = parseBuiltIn(body);
    if (!builtIn) return ctx.values[body] ?? '';
    switch (builtIn.kind) {
      case 'counter':
        return ctx.counter;
      case 'time':
        return builtIn.format ? formatDate(ctx.now, builtIn.format, ctx.locale) : defaultTime(ctx.now, ctx.locale);
      case 'date': {
        const date = addDays(ctx.now, builtIn.offsetDays);
        return builtIn.format ? formatDate(date, builtIn.format, ctx.locale) : defaultDate(date, ctx.locale);
      }
    }
  });
}

/** Uppercase the literal text but leave {{variable}} names untouched. */
export function uppercaseOutsideVariables(text: string): string {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    result += text.slice(last, match.index).toUpperCase() + match[0];
    last = match.index + match[0].length;
  }
  return result + text.slice(last).toUpperCase();
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function defaultDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function defaultTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

const FORMAT_TOKENS = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a date with simple moment-style tokens. Text in [brackets] is kept literally. */
export function formatDate(date: Date, format: string, locale?: string): string {
  const monthLong = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  const dayLong = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  const dayShort = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  const hours = date.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: monthLong,
    MMM: monthShort,
    MM: pad2(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    D: String(date.getDate()),
    dddd: dayLong,
    ddd: dayShort,
    HH: pad2(hours),
    H: String(hours),
    hh: pad2(h12),
    h: String(h12),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
    A: hours < 12 ? 'AM' : 'PM',
  };
  return format
    .split(/(\[[^\]]*\])/)
    .map((part) => (part.startsWith('[') && part.endsWith(']') ? part.slice(1, -1) : part.replace(FORMAT_TOKENS, (t) => tokens[t] ?? t)))
    .join('');
}
