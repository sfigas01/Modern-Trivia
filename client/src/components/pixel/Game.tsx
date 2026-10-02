import { useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { PixelButton } from './Pixel';

// In-game building blocks of the pixel design system (STE-128), shared by the
// solo game and the multiplayer room. Styling lives in pixel.css.

const DIFFICULTY_CLASS: Record<string, string> = {
  Easy: 'tc-chip--easy',
  Medium: 'tc-chip--medium',
  Hard: 'tc-chip--hard',
};

export function PixelChip({
  children,
  tone,
  testId,
}: {
  children: ReactNode;
  tone?: 'easy' | 'medium' | 'hard' | 'magenta';
  testId?: string;
}) {
  return (
    <span className={`tc-chip${tone ? ` tc-chip--${tone}` : ''}`} data-testid={testId}>
      {children}
    </span>
  );
}

export function PixelQuestionCard({
  category,
  difficulty,
  question,
  chips,
  size = 'lg',
}: {
  category: string;
  difficulty: string;
  question: string;
  chips?: ReactNode;
  size?: 'lg' | 'md';
}) {
  return (
    <section className="tc-frame tc-question" aria-label="Question">
      <div className="tc-chips">
        <span className="tc-chip">{category}</span>
        <span className={`tc-chip ${DIFFICULTY_CLASS[difficulty] ?? ''}`}>{difficulty}</span>
        {chips}
      </div>
      <h1 className={`tc-question__text tc-question__text--${size}`}>{question}</h1>
    </section>
  );
}

export function PixelAnswerForm({
  value,
  onChange,
  onSubmit,
  onPass,
  disabled,
  submitDisabled,
  submitLabel = 'Submit Answer',
  passDisabled,
  placeholder = 'Type answer here...',
  inputTestId,
  submitTestId,
  passTestId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPass: () => void;
  disabled?: boolean;
  submitDisabled?: boolean;
  submitLabel?: ReactNode;
  passDisabled?: boolean;
  placeholder?: string;
  inputTestId?: string;
  submitTestId?: string;
  passTestId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <form
      className="tc-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="pixel-answer" className="sr-only">
        Your answer
      </label>
      <input
        id="pixel-answer"
        ref={inputRef}
        className="tc-field tc-field--answer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => inputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })}
        placeholder={placeholder}
        autoFocus
        autoComplete="off"
        disabled={disabled}
        data-testid={inputTestId}
      />
      <div className="tc-answer-actions">
        <PixelButton
          variant="stone"
          onClick={onPass}
          disabled={passDisabled ?? disabled}
          data-testid={passTestId}
        >
          Pass
        </PixelButton>
        <PixelButton
          type="submit"
          variant="magenta"
          disabled={submitDisabled ?? (disabled || !value.trim())}
          data-testid={submitTestId}
        >
          {submitLabel}
        </PixelButton>
      </div>
    </form>
  );
}

const VERDICT_TONE: Record<string, string> = {
  CORRECT: 'tc-verdict--correct',
  INCORRECT: 'tc-verdict--incorrect',
  PASS: 'tc-verdict--pass',
};

export function formatDelta(delta: number) {
  return `${delta > 0 ? '+' : ''}${delta}`;
}

export function PixelRevealCards({
  answeredLabel,
  submittedAnswer,
  verdict,
  pointsDelta,
  correctLabel = 'Correct Answer',
  correctAnswer,
  cardTestId,
  verdictTestId,
}: {
  answeredLabel: string;
  submittedAnswer: string | null;
  verdict?: string;
  pointsDelta?: number;
  correctLabel?: string;
  correctAnswer: string;
  cardTestId?: string;
  verdictTestId?: string;
}) {
  return (
    <div className="tc-reveal">
      <div
        className={`tc-verdict ${verdict ? (VERDICT_TONE[verdict] ?? '') : 'tc-verdict--incorrect'}`}
        data-testid={cardTestId}
      >
        <p className="tc-verdict__label">{answeredLabel}</p>
        <p className="tc-verdict__answer">{submittedAnswer || '(Passed)'}</p>
        {verdict && pointsDelta !== undefined && (
          <p className="tc-verdict__label" data-testid={verdictTestId}>
            {verdict} ({formatDelta(pointsDelta)})
          </p>
        )}
      </div>
      <div className="tc-verdict tc-verdict--answer">
        <p className="tc-verdict__label">{correctLabel}</p>
        <p className="tc-verdict__answer tc-verdict__answer--gold">{correctAnswer}</p>
      </div>
    </div>
  );
}

export function PixelFactCard({
  explanation,
  sourceUrl,
  sourceName,
}: {
  explanation?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
}) {
  if (!explanation && !sourceUrl) return null;
  return (
    <div className="tc-parchment tc-fact">
      {explanation && <p>{explanation}</p>}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="tc-btn tc-btn--stone tc-btn--sm tc-fact__source"
        >
          {sourceName || 'Verify Source'}
        </a>
      )}
    </div>
  );
}

export interface StandingRow {
  id: string;
  name: string;
  score: number;
  delta?: number;
  note?: string;
  faded?: boolean;
}

export function PixelStandings({
  rows,
  rowTestId,
  deltaTestId,
}: {
  rows: StandingRow[];
  rowTestId?: (id: string) => string;
  deltaTestId?: (id: string) => string;
}) {
  return (
    <ol className="tc-stack tc-standings">
      {rows.map((row, index) => (
        <li
          key={row.id}
          className="tc-sub tc-standing"
          data-faded={row.faded || undefined}
          data-testid={rowTestId?.(row.id)}
        >
          <span className="tc-standing__rank">#{index + 1}</span>
          <span className="tc-standing__name">
            {row.name}
            {row.note && <span className="tc-player__note"> {row.note}</span>}
          </span>
          <span className="tc-standing__score">
            {row.score}
            {row.delta !== undefined && row.delta !== 0 && (
              <span
                className={`tc-standing__delta ${row.delta > 0 ? 'is-up' : 'is-down'}`}
                data-testid={deltaTestId?.(row.id)}
              >
                {' '}
                ({formatDelta(row.delta)})
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

// "Round N Complete" pill over the ROUND SCORES title art (Clash Block).
export function PixelRoundHeader({ label }: { label: string }) {
  return (
    <header className="tc-stack" style={{ gap: 16, alignItems: 'center' }}>
      <p className="tc-pill">{label}</p>
      <h1 className="tc-wordmark tc-round-title">
        <img src="/brand/round-scores-title.svg" alt="Round Scores" width={456} height={212} />
      </h1>
    </header>
  );
}

export function PixelProgress({ value, testId }: { value: number; testId?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className="tc-progress"
      role="progressbar"
      aria-label="Game progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      data-testid={testId}
    >
      <div className="tc-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Modal dialog in the pixel style. Radix handles focus trapping, Escape and
// aria wiring; `dismissible` false keeps it open on outside clicks.
export function PixelDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
  dismissible?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="tc-scrim" />
        <DialogPrimitive.Content
          className="tc-dialog tc-frame"
          data-testid={testId}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
        >
          <DialogPrimitive.Title className="tc-frame__title">{title}</DialogPrimitive.Title>
          <div className="tc-frame__body">
            {description ? (
              <DialogPrimitive.Description className="tc-hint">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function PixelDialogActions({ children }: { children: ReactNode }) {
  return <div className="tc-dialog__actions">{children}</div>;
}

export function PixelLoading({ label, testId }: { label: string; testId?: string }) {
  return (
    <div className="tc-loading" role="status">
      <span className="tc-busy" aria-hidden="true" />
      <p className="tc-tagline" data-testid={testId}>
        {label}
      </p>
    </div>
  );
}
