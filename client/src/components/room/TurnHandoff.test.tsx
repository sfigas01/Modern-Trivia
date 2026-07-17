import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TurnHandoff } from './TurnHandoff';

describe('TurnHandoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the player's nickname", () => {
    render(<TurnHandoff nickname="Alice" onDismiss={vi.fn()} />);

    expect(screen.getByText("It’s Alice’s turn!")).toBeInTheDocument();
  });

  it('calls onDismiss after the dismiss delay elapses', () => {
    const onDismiss = vi.fn();
    render(<TurnHandoff nickname="Alice" onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss if unmounted before the delay elapses', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<TurnHandoff nickname="Alice" onDismiss={onDismiss} />);

    unmount();
    vi.advanceTimersByTime(2000);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
