import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'wouter';
import './pixel.css';

// Building blocks of the Super Questly pixel design system (STE-128).
// Styling lives in pixel.css; these only assemble the markup.

// `wide` gives in-game screens a wider column on desktop.
export function PixelScreen({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="tc-screen">
      <div className="tc-world" aria-hidden="true" />
      <main className={wide ? 'tc-column tc-column--game' : 'tc-column'}>{children}</main>
    </div>
  );
}

// The SUPER QUESTLY wordmark, the same size on every screen, and always a
// link home. `onHome` lets a screen that lives at "/" itself (solo setup)
// reset its own state, since navigating to the current URL changes nothing.
export function PixelWordmark({ onHome }: { onHome?: () => void }) {
  return (
    <h1 className="tc-wordmark">
      <Link href="/" onClick={onHome} title="Home">
        <img src="/brand/super-questly-wordmark.svg" alt="Super Questly" width={520} height={212} />
      </Link>
    </h1>
  );
}

// Inner-screen header: the wordmark over the page title chip.
export function PixelPageHeader({ title }: { title: string }) {
  return (
    <header className="tc-stack" style={{ gap: 16 }}>
      <PixelWordmark />
      <h2 className="tc-tagline">{title}</h2>
    </header>
  );
}

export function PixelFrame({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="tc-frame" data-testid={testId}>
      <h2 className="tc-frame__title">{title}</h2>
      <div className="tc-frame__body">{children}</div>
    </section>
  );
}

type PixelButtonVariant = 'red' | 'magenta' | 'green' | 'stone' | 'coin' | 'panel';

export function pixelButtonClass({
  variant = 'panel',
  size,
  block,
}: {
  variant?: PixelButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
}) {
  return [
    'tc-btn',
    variant !== 'panel' && `tc-btn--${variant}`,
    size && `tc-btn--${size}`,
    block && 'tc-btn--block',
  ]
    .filter(Boolean)
    .join(' ');
}

export function PixelButton({
  variant,
  size,
  block,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: PixelButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const classes = [pixelButtonClass({ variant, size, block }), className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}

// Placeholder avatar tiles until the pixel sprite set lands (STE-160).
const AVATAR_COLORS = ['#d83a2a', '#2e7c2e', '#b23bb0', '#c0662e', '#1d4499', '#6f6a63'];

export function PixelAvatar({ name, index }: { name: string; index: number }) {
  return (
    <span
      className="tc-avatar"
      aria-hidden="true"
      style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

// Category picker: "All" plus every category, sized to show up to nine tiles
// without scrolling. Names use the body face in Title Case (design system
// casing rule for proper nouns) so long names fit two columns on a phone.
export function PixelCategoryGrid({
  categories,
  selected,
  counts,
  onToggle,
  disabled,
}: {
  categories: string[];
  selected: string[];
  counts: Record<string, number>;
  onToggle: (category: string) => void;
  disabled?: boolean;
}) {
  const tiles = ['All', ...categories.filter((c) => c !== 'All')];
  return (
    <div className="tc-grid-2 tc-cat-grid">
      {tiles.map((category) => (
        <button
          key={category}
          type="button"
          className="tc-slot tc-cat"
          aria-pressed={category === 'All' ? selected.length === 0 : selected.includes(category)}
          onClick={() => onToggle(category)}
          disabled={disabled}
        >
          <span className="tc-cat__name">{category}</span>{' '}
          <span className="tc-slot__count">({counts[category] || 0})</span>
        </button>
      ))}
    </div>
  );
}

export function PixelRoundPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly number[];
  value: number;
  onChange: (rounds: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tc-grid-4">
      {options.map((rounds) => (
        <button
          key={rounds}
          type="button"
          className="tc-slot"
          aria-pressed={value === rounds}
          aria-label={`${rounds} rounds`}
          onClick={() => onChange(rounds)}
          disabled={disabled}
        >
          <span className="tc-coin">
            <span className="tc-coin__face">{rounds}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// On/off switch with the pixel look; a real role="switch" button.
export function PixelSwitch({
  checked,
  onChange,
  label,
  describedBy,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      className="tc-switch"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="tc-switch__knob" />
      <span className="tc-switch__text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

// Busy indicator for buttons ("Creating Room...").
export function PixelBusy() {
  return <span className="tc-busy" role="status" aria-label="Loading" />;
}
