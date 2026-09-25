import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const ERROR_PATTERN = /\b(error|failed|failure|fatal|critical)\b/i;
const WARNING_PATTERN = /\b(warn|warning|retry|retrying|timeout|timed out)\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps every case-insensitive occurrence of `pattern` in a <mark>. */
function highlight(line: string, pattern: RegExp | null): React.ReactNode {
  if (!pattern) return line;
  const parts = line.split(pattern);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-[2px] bg-warn-soft text-ink shadow-[0_0_0_1px_var(--color-warn-soft)]">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function lineTone(line: string): string {
  if (ERROR_PATTERN.test(line)) return 'text-bad';
  if (WARNING_PATTERN.test(line)) return 'text-warn';
  return 'text-ink-2';
}

export interface LogViewerProps {
  lines: string[];
  filter: string;
  /** Changes when a different log is shown, which jumps back to the newest line. */
  sourceKey: string;
  label: string;
  className?: string;
}

/**
 * Monospace journal tail. Stays pinned to the newest line unless the reader
 * has scrolled up to look at something.
 */
export function LogViewer({ lines, filter, sourceKey, label, className }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastSourceRef = useRef(sourceKey);

  const pattern = useMemo(() => (filter ? new RegExp(`(${escapeRegExp(filter)})`, 'gi') : null), [filter]);
  const visible = useMemo(() => {
    const numbered = lines.map((text, index) => ({ text, number: index + 1 }));
    if (!filter) return numbered;
    const needle = filter.toLowerCase();
    return numbered.filter((line) => line.text.toLowerCase().includes(needle));
  }, [lines, filter]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (lastSourceRef.current !== sourceKey) {
      lastSourceRef.current = sourceKey;
      pinnedRef.current = true;
    }
    if (pinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [visible, sourceKey]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
  }

  const gutterWidth = `${String(lines.length).length + 1}ch`;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-label={label}
      tabIndex={0}
      className={cn('overflow-auto bg-surface py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-inset', className)}
    >
      {visible.length === 0 ? (
        <p className="px-4 py-6 font-sans text-sm text-ink-3">{filter ? `No lines contain “${filter}”.` : 'This log is empty.'}</p>
      ) : (
        <ol>
          {visible.map((line) => (
            <li key={line.number} className="flex gap-3 px-4 hover:bg-ink/[0.03]">
              <span aria-hidden className="tabular shrink-0 text-right text-ink-4 select-none" style={{ width: gutterWidth }}>
                {line.number}
              </span>
              <span className={cn('min-w-0 flex-1 break-words whitespace-pre-wrap', lineTone(line.text))}>{highlight(line.text, pattern)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
