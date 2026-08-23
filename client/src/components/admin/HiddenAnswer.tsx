import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HiddenAnswerProps {
  /** The answer text to protect. */
  answer: string;
  /**
   * Inline label prefix rendered before the value (e.g. "A:").
   * Pass `null` or an empty string to omit it.
   */
  label?: string | null;
  /** Extra classes for the outer wrapper. */
  className?: string;
  /** Classes applied to the revealed answer text (lets callers preserve emphasis). */
  valueClassName?: string;
  /**
   * Base used to build the data-testids. Defaults to the first 8 chars of the
   * answer so tests can target a stable-ish handle; pass an id-based value when
   * available to keep testids deterministic.
   */
  testId?: string;
}

/**
 * Spoiler-safe answer display for admin surfaces. The admin is also a player,
 * so answers are masked by default and only shown after an explicit reveal
 * click. The revealed state is component-local, so it never persists across
 * navigation or re-renders of the parent list.
 */
export function HiddenAnswer({
  answer,
  label = 'A:',
  className,
  valueClassName,
  testId,
}: HiddenAnswerProps) {
  const [revealed, setRevealed] = useState(false);
  const idBase = testId ?? answer.slice(0, 8);
  const masked = '•'.repeat(Math.min(answer.length, 12)) || '•••';

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      {label ? <span className="font-medium">{label}</span> : null}
      {revealed ? (
        <span data-testid={`text-answer-${idBase}`} className={valueClassName}>
          {answer}
        </span>
      ) : (
        <span
          className="tracking-widest select-none"
          data-testid={`masked-answer-${idBase}`}
          aria-hidden="true"
        >
          {masked}
        </span>
      )}
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
        title={revealed ? 'Hide answer' : 'Reveal answer'}
        aria-label={revealed ? 'Hide answer' : 'Reveal answer'}
        data-testid={`button-toggle-answer-${idBase}`}
      >
        {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
    </span>
  );
}
