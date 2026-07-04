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
    presence: 'online',
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
    render(<PlayerRoster players={players} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('marks the current player with a (you) label', () => {
    const players = [makePlayer({ id: 'p1', nickname: 'Alice' })];
    render(<PlayerRoster players={players} currentPlayerId="p1" />);

    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('shows an online presence dot for players seen recently', () => {
    const players = [makePlayer({ id: 'p1', presence: 'online' })];
    render(<PlayerRoster players={players} />);

    expect(screen.getByTestId('presence-dot-p1')).toHaveAttribute('aria-label', 'Online');
  });

  it('shows an away presence dot for players between the online and stale thresholds', () => {
    const players = [makePlayer({ id: 'p1', presence: 'away' })];
    render(<PlayerRoster players={players} />);

    expect(screen.getByTestId('presence-dot-p1')).toHaveAttribute('aria-label', 'Away');
  });

  it('greys out stale players', () => {
    const players = [makePlayer({ id: 'p1', presence: 'stale' })];
    render(<PlayerRoster players={players} />);

    expect(screen.getByTestId('presence-dot-p1')).toHaveAttribute('aria-label', 'Stale');
    expect(screen.getByTestId('player-row-p1').className).toContain('opacity-50');
  });

  it('highlights the active player', () => {
    const players = [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', joinOrder: 1 })];
    render(<PlayerRoster players={players} activePlayerId="p1" />);

    expect(screen.getByTestId('player-row-p1').className).toContain('ring-2');
    expect(screen.getByTestId('player-row-p2').className).not.toContain('ring-2');
  });

  it('shows a crown for the host', () => {
    const players = [makePlayer({ id: 'p1', isHost: true })];
    const { container } = render(<PlayerRoster players={players} />);

    expect(container.querySelector('svg')).not.toBeNull();
  });
});
