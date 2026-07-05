import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UseMutationResult } from '@tanstack/react-query';

import { QuestionView } from './QuestionView';
import type { AnswerRoomRequest, AnswerRoomResponse, RoomSnapshot } from '@shared/models/rooms';

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type QuestionSnapshot = Extract<RoomSnapshot, { phase: 'QUESTION' }>;

function makePlayer(overrides: Partial<QuestionSnapshot['players'][number]> = {}) {
  return {
    id: 'p1',
    nickname: 'Alice',
    joinOrder: 0,
    score: 0,
    questionCount: 0,
    lastRoundDelta: 0,
    isHost: true,
    presence: 'online' as const,
    lastSeenAt: new Date().toISOString(),
    leftAt: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<QuestionSnapshot> = {}): QuestionSnapshot {
  return {
    id: 'room-1',
    code: 'ABCDE',
    status: 'active',
    phase: 'QUESTION',
    version: 3,
    hostPlayerId: 'p1',
    category: 'All',
    numRounds: 10,
    currentQuestionIndex: 0,
    activePlayerId: 'p1',
    currentAttempt: null,
    currentQuestion: {
      id: 'q1',
      category: 'Science',
      difficulty: 'Medium',
      question: 'What planet is closest to the sun?',
      pillar: 'Astronomy',
      tags: [],
      sourceUrl: null,
      sourceName: null,
    },
    players: [makePlayer({ id: 'p1', nickname: 'Alice' }), makePlayer({ id: 'p2', nickname: 'Bob', isHost: false })],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  } as QuestionSnapshot;
}

function makeMutation(
  overrides: Partial<{ isPending: boolean; mutate: ReturnType<typeof vi.fn> }> = {}
): UseMutationResult<AnswerRoomResponse, Error, AnswerRoomRequest> {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as UseMutationResult<AnswerRoomResponse, Error, AnswerRoomRequest>;
}

describe('QuestionView', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the answer input and buttons for the active player', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('badge-your-turn')).toBeInTheDocument();
    expect(screen.getByTestId('input-answer')).toBeInTheDocument();
    expect(screen.getByTestId('button-submit-answer')).toBeInTheDocument();
    expect(screen.getByTestId('button-pass')).toBeInTheDocument();
  });

  it('renders no input or buttons for a spectator', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p2"
        answer={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.queryByTestId('input-answer')).toBeNull();
    expect(screen.queryByTestId('button-submit-answer')).toBeNull();
    expect(screen.queryByTestId('button-pass')).toBeNull();
    expect(screen.getByTestId('text-waiting-turn')).toHaveTextContent('Alice');
  });

  it('disables Submit until an answer is typed', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation()}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('button-submit-answer')).toBeDisabled();
    fireEvent.change(screen.getByTestId('input-answer'), { target: { value: 'Mercury' } });
    expect(screen.getByTestId('button-submit-answer')).not.toBeDisabled();
  });

  it('disables Submit and Pass while a mutation is in flight', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation({ isPending: true })}
        refetch={vi.fn()}
      />
    );

    expect(screen.getByTestId('button-submit-answer')).toBeDisabled();
    expect(screen.getByTestId('button-pass')).toBeDisabled();
  });

  it('submits the typed answer', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const mutate = vi.fn();
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation({ mutate })}
        refetch={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId('input-answer'), { target: { value: 'Mercury' } });
    fireEvent.click(screen.getByTestId('button-submit-answer'));

    expect(mutate).toHaveBeenCalledWith({ answer: 'Mercury' }, expect.any(Object));
  });

  it('passes with a null answer', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const mutate = vi.fn();
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation({ mutate })}
        refetch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('button-pass'));

    expect(mutate).toHaveBeenCalledWith({ answer: null }, expect.any(Object));
  });

  it('reconciles silently on a 409 conflict instead of showing a toast', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const refetch = vi.fn();
    const mutate = vi.fn((_body, options) => {
      const error = new Error('Room is not accepting answers') as Error & { status: number };
      error.status = 409;
      options.onError(error);
    });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation({ mutate })}
        refetch={refetch}
      />
    );

    fireEvent.click(screen.getByTestId('button-pass'));

    expect(refetch).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows a toast for non-conflict errors', () => {
    const snapshot = makeSnapshot({ activePlayerId: 'p1' });
    const refetch = vi.fn();
    const mutate = vi.fn((_body, options) => {
      options.onError(new Error('Server exploded'));
    });
    render(
      <QuestionView
        snapshot={snapshot}
        currentPlayerId="p1"
        answer={makeMutation({ mutate })}
        refetch={refetch}
      />
    );

    fireEvent.click(screen.getByTestId('button-pass'));

    expect(refetch).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Server exploded');
  });
});
