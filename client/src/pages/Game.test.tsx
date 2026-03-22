import React, { useEffect, useRef } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Game from './Game';
import { GameProvider, useGame } from '@/lib/store';

// Stub localStorage for jsdom compatibility
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    for (const key of Object.keys(storage)) delete storage[key];
  },
});

const GAME_TEST_QUESTIONS = Array.from({ length: 10 }, (_, i) => ({
  id: `game-q-${i + 1}`,
  category: i < 5 ? 'Science' : 'History',
  difficulty: 'Easy' as const,
  question: `Question ${i + 1}?`,
  answer: `Answer ${i + 1}`,
  explanation: `Explanation ${i + 1}`,
  tags: [],
}));

function createFetchMock() {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/api/questions/seen')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }

    if (url.includes('/api/questions')) {
      const parsed = new URL(url, 'http://localhost');
      const limit = parsed.searchParams.get('limit');
      const questions = limit
        ? GAME_TEST_QUESTIONS.slice(0, parseInt(limit, 10))
        : GAME_TEST_QUESTIONS;
      const categories = Array.from(new Set(GAME_TEST_QUESTIONS.map((q) => q.category))).sort();

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions, categories }),
      } as Response);
    }

    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

vi.mock('wouter', () => ({
  useLocation: () => ['/game', vi.fn()],
}));

vi.mock('@/components/DisputeModal', () => ({
  DisputeModal: () => null,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(
      (
        {
          children,
          initial: _initial,
          animate: _animate,
          exit: _exit,
          transition: _transition,
          layout: _layout,
          ...props
        }: React.HTMLAttributes<HTMLDivElement> & {
          initial?: unknown;
          animate?: unknown;
          exit?: unknown;
          transition?: unknown;
          layout?: boolean;
        },
        ref: React.Ref<HTMLDivElement>
      ) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function AutoStartGame({
  teamNames = ['Alpha', 'Bravo'],
  numRounds = 5,
}: {
  teamNames?: string[];
  numRounds?: number;
}) {
  const { state, addTeam, setNumRounds, startGame } = useGame();
  const seededRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || state.phase !== 'SETUP' || state.questions.length === 0) return;

    seededRef.current = true;
    teamNames.forEach((teamName) => addTeam(teamName));
    setNumRounds(numRounds);
  }, [addTeam, numRounds, setNumRounds, state.phase, state.questions.length, teamNames]);

  useEffect(() => {
    if (
      startedRef.current ||
      state.phase !== 'SETUP' ||
      state.teams.length !== teamNames.length ||
      state.numRounds !== numRounds
    ) {
      return;
    }

    startedRef.current = true;
    void startGame();
  }, [numRounds, startGame, state.numRounds, state.phase, state.teams.length, teamNames.length]);

  return null;
}

function renderGamePage() {
  return render(
    <GameProvider>
      <AutoStartGame />
      <Game />
    </GameProvider>
  );
}

async function passQuestionAndAdvance() {
  fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
  expect(await screen.findByText('They Answered')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /NEXT QUESTION/i }));
}

describe('Game page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('plays through question, reveal, round score, next round, and game over', async () => {
    renderGamePage();

    expect(await screen.findByText('Question 1?')).toBeDefined();
    expect(screen.getByText('Active Team')).toBeDefined();
    expect(screen.getByText('Question 1/4')).toBeDefined();

    for (let questionNumber = 1; questionNumber <= 4; questionNumber++) {
      await passQuestionAndAdvance();
      expect(await screen.findByText(`Question ${questionNumber + 1}?`)).toBeDefined();
    }

    expect(screen.getAllByText('Bravo').length).toBeGreaterThan(0);
    expect(screen.getByText('Question 1/4')).toBeDefined();

    for (let questionNumber = 5; questionNumber <= 7; questionNumber++) {
      await passQuestionAndAdvance();
      expect(await screen.findByText(`Question ${questionNumber + 1}?`)).toBeDefined();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(await screen.findByText('They Answered')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /NEXT QUESTION/i }));

    expect(await screen.findByText('Round Scores')).toBeDefined();
    expect(screen.getByText('Round 1 Complete')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /NEXT ROUND/i }));
    expect(await screen.findByText('Question 9?')).toBeDefined();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);

    await passQuestionAndAdvance();
    expect(await screen.findByText('Question 10?')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(await screen.findByText('They Answered')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /NEXT QUESTION/i }));

    expect(await screen.findByText('Game Over')).toBeDefined();
    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByRole('button', { name: /Start New Game/i })).toBeDefined();
  });
});
