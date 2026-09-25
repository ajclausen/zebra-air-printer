import { describe, expect, it } from 'vitest';
import { extractFieldKeys, formatDate, hasVariables, parseBuiltIn, substitute, uppercaseOutsideVariables, usesCounter } from './variables';

const now = new Date(2026, 8, 25, 15, 5, 9); // Fri Sep 25 2026 15:05:09 local
const ctx = { values: { Name: 'Ada Lovelace', 'Ship to': 'Dock 4' }, counter: '007', now, locale: 'en-US' };

describe('substitute', () => {
  it('replaces custom fields, tolerating inner whitespace', () => {
    expect(substitute('Hello {{Name}} / {{ Ship to }}', ctx)).toBe('Hello Ada Lovelace / Dock 4');
  });

  it('replaces unknown fields with an empty string', () => {
    expect(substitute('[{{Missing}}]', ctx)).toBe('[]');
  });

  it('replaces the counter', () => {
    expect(substitute('Bin {{counter}}', ctx)).toBe('Bin 007');
  });

  it('formats {{date}} and {{time}} with the locale defaults', () => {
    expect(substitute('{{date}}', ctx)).toBe('Sep 25, 2026');
    expect(substitute('{{time}}', ctx)).toBe('3:05 PM');
  });

  it('supports date offsets and custom formats', () => {
    expect(substitute('{{date+7}}', ctx)).toBe('Oct 2, 2026');
    expect(substitute('{{date-25:YYYY-MM-DD}}', ctx)).toBe('2026-08-31');
    expect(substitute('{{date:ddd D MMM}}', ctx)).toBe('Fri 25 Sep');
    expect(substitute('{{time:HH:mm:ss}}', ctx)).toBe('15:05:09');
  });

  it('is case-insensitive for built-ins', () => {
    expect(substitute('{{DATE:YY}} {{Counter}}', ctx)).toBe('26 007');
  });

  it('leaves text without variables untouched', () => {
    expect(substitute('Plain {text} and }}{{', ctx)).toBe('Plain {text} and }}{{');
  });
});

describe('formatDate', () => {
  it('keeps [bracketed] text literal', () => {
    expect(formatDate(now, '[Day] D [of] MMMM', 'en-US')).toBe('Day 25 of September');
  });

  it('renders 12-hour clock tokens', () => {
    expect(formatDate(new Date(2026, 0, 1, 0, 7), 'h:mm A', 'en-US')).toBe('12:07 AM');
  });
});

describe('field extraction', () => {
  it('lists custom fields in order of first use, excluding built-ins', () => {
    expect(extractFieldKeys(['{{Name}} {{date}}', '{{Plate}} {{Name}} {{counter}} {{time:HH}}', '{{date+3}}'])).toEqual(['Name', 'Plate']);
  });

  it('finds the first variable even after hasVariables was called (regex state regression)', () => {
    expect(hasVariables('{{Reference}}')).toBe(true);
    expect(extractFieldKeys(['{{Reference}}', '{{Name}} and {{Other}}'])).toEqual(['Reference', 'Name', 'Other']);
    expect(hasVariables('plain')).toBe(false);
  });

  it('detects the counter', () => {
    expect(usesCounter(['No. {{ counter }}'])).toBe(true);
    expect(usesCounter(['{{date}}'])).toBe(false);
  });

  it('parses built-ins and rejects malformed ones as custom fields', () => {
    expect(parseBuiltIn('date+3:MMM')).toEqual({ kind: 'date', offsetDays: 3, format: 'MMM' });
    expect(parseBuiltIn('counter+1')).toBeNull();
    expect(parseBuiltIn('Dated')).toBeNull();
  });
});

describe('uppercaseOutsideVariables', () => {
  it('uppercases literal text only', () => {
    expect(uppercaseOutsideVariables('opened {{date}} by {{Name}}')).toBe('OPENED {{date}} BY {{Name}}');
  });
});
