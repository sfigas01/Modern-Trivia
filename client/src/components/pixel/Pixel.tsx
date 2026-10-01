import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './pixel.css';

// Building blocks of the Trivia Clash pixel design system (STE-128).
// Styling lives in pixel.css; these only assemble the markup.

export function PixelScreen({ children }: { children: ReactNode }) {
  return (
    <div className="tc-screen">
      <div className="tc-world" aria-hidden="true" />
      <main className="tc-column">{children}</main>
    </div>
  );
}

export function PixelWordmark() {
  return (
    <h1 className="tc-wordmark">
      <img src="/brand/super-questly-wordmark.svg" alt="Super Questly" width={520} height={212} />
    </h1>
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
