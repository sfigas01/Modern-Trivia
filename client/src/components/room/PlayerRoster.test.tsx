import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { PlayerRoster } from './PlayerRoster';
import type { RoomPlayerSnapshot } from '@shared/models/rooms';

const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

function makePlayer(overrides: Partial<RoomPlayerSnapshot> = {}): RoomPlayerSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    nickname: 'Steph',
    joinOrder: 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: false,
    lastSeenAt: new Date(NOW).toISOString(),
    leftAt: null,
    ...overrides,
  };
}

describe('PlayerRoster', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders every player with nickname and score', () => {
    const players = [
      makePlayer({ id: 'p1', nickname: 'Alice', score: 10, joinOrder: 0 }),
      makePlayer({ id: 'p2', nickname: 'Bob', score: 5, joinOrder: 1 }),
    ];
    render(<PlayerRoster players={players} now={NOW} />);

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('marks the current player with a (you) label', () => {
    const players = [makePlayer({ id: 'p1', nickname: 'Alice' })];
    render(<PlayerRoster players={players} currentPlayerId="p1" now={NOW} />);

    expect(screen.getByText('(you)')).toBeDefined();
  });

  it('shows an online presence dot for players seen recently', () => {
    const players = [makePlayer({ id: 'p1', lastSeenAt: new Date(NOW - 2000).toISOString() })];
    render(<PlayerRoster players={players} now={NOW} />);

    expect(screen.getByTestId('presence-dot-p1')).toHaveAttribute('aria-label', 'Online');
  });

  it('shows an offline presence dot for players not seen recently', () => {
    const players = [makePlayer({ id: 'p1', lastSeenAt: new Date(NOW - 15000).toISOString() })];
    render(<PlayerRoster players={players} now={NOW} />);

    expect(screen.getByTestId('presence-dot-p1')).toHaveAttribute('aria-label', 'Offline');
  });

  it('highlights the active player', () => {
    const players = [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', joinOrder: 1 })];
    render(<PlayerRoster players={players} activePlayerId="p1" now={NOW} />);

    expect(screen.getByTestId('player-row-p1').className).toContain('ring-2');
    expect(screen.getByTestId('player-row-p2').className).not.toContain('ring-2');
  });

  it('shows a crown for the host', () => {
    const players = [makePlayer({ id: 'p1', isHost: true })];
    const { container } = render(<PlayerRoster players={players} now={NOW} />);

    expect(container.querySelector('svg')).not.toBeNull();
  });
});
