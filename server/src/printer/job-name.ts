/** IPP name values are limited; LPrint and clients show far less than this anyway. */
export const MAX_JOB_NAME_BYTES = 200;

// C0 controls, DEL, and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

const utf8Length = (s: string) => Buffer.byteLength(s, 'utf8');

/** Cuts `text` to at most `maxBytes` of UTF-8 without splitting a code point. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) return text;
  let out = '';
  let bytes = 0;
  for (const codePoint of text) {
    const size = utf8Length(codePoint);
    if (bytes + size > maxBytes) break;
    out += codePoint;
    bytes += size;
  }
  return out;
}

/**
 * Job name for label `index` (0-based) of `total`: control characters become spaces,
 * multi-label jobs get a " (i/N)" suffix, and the result fits in MAX_JOB_NAME_BYTES.
 */
export function jobName(name: string, index = 0, total = 1): string {
  const clean = name.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'Label';
  const suffix = total > 1 ? ` (${index + 1}/${total})` : '';
  const base = truncateUtf8(clean, MAX_JOB_NAME_BYTES - utf8Length(suffix)).trimEnd();
  return base + suffix;
}
