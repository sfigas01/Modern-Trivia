import '@testing-library/jest-dom/vitest';
import React, { useEffect, useRef } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GamePixel from './GamePixel';
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
      <GamePixel />
    </GameProvider>
  );
}

// Pixel solo game (STE-134..158): Game.tsx renders GamePixel when
// VITE_PIXEL_UI is on.
describe('Pixel solo game', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
  });

  async function currentQuestionNumber() {
    const heading = await screen.findByRole('heading', { name: /^Question \d+\?$/ });
    return Number(heading.textContent!.match(/\d+/)![0]);
  }

  it('shows the question, category, difficulty and active team', async () => {
    renderGamePage();
    const n = await currentQuestionNumber();
    expect(screen.getByText(n <= 5 ? 'Science' : 'History')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Active team' })).toHaveTextContent('Alpha');
    expect(screen.getByRole('progressbar', { name: 'Game progress' })).toBeInTheDocument();
  });

  it('reveals a correct answer and moves to the next question', async () => {
    renderGamePage();
    const n = await currentQuestionNumber();
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: `Answer ${n}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));

    expect(await screen.findByText('They Answered')).toBeInTheDocument();
    expect(screen.getByText(/CORRECT \(\+\d+\)/)).toBeInTheDocument();
    expect(screen.getByText(`Explanation ${n}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    expect(await screen.findByLabelText('Your answer')).toBeInTheDocument();
    expect(await currentQuestionNumber()).not.toBe(n);
  });

  it('offers a dispute after a wrong answer and opens the dispute dialog', async () => {
    renderGamePage();
    const n = await currentQuestionNumber();
    fireEvent.change(screen.getByLabelText('Your answer'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dispute' }));

    const dialog = await screen.findByRole('dialog', { name: 'Dispute This Answer' });
    expect(dialog).toHaveTextContent(`Answer ${n}`);
    expect(dialog).toHaveTextContent('nope');
  });

  it('passes a question', async () => {
    renderGamePage();
    fireEvent.click(await screen.findByRole('button', { name: 'Pass' }));
    expect(await screen.findByText('(Passed)')).toBeInTheDocument();
  });

  it('ends the game early from the Quit dialog and shows final scores', async () => {
    renderGamePage();
    fireEvent.click(await screen.findByRole('button', { name: 'Exit game' }));
    expect(await screen.findByRole('dialog', { name: 'End Game Early?' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-confirm-quit'));

    expect(await screen.findByRole('heading', { name: 'Game Over' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final Scores' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start New Game' })).toBeInTheDocument();
  });
});
