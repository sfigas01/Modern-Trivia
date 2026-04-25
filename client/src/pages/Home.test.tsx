import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './Home';
import { GameProvider } from '@/lib/store';

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

// ---------------------------------------------------------------------------
// Fetch mock — intercepts /api/questions used by the store
// ---------------------------------------------------------------------------

const HOME_TEST_QUESTIONS = [
  {
    id: 'q1',
    category: 'Geography',
    difficulty: 'Easy',
    question: 'Capital of Canada?',
    answer: 'Ottawa',
    explanation: 'Ottawa is the capital.',
    tags: [],
  },
  {
    id: 'q2',
    category: 'Science',
    difficulty: 'Medium',
    question: 'H2O?',
    answer: 'Water',
    explanation: 'H2O is water.',
    tags: [],
  },
  {
    id: 'q3',
    category: 'History',
    difficulty: 'Hard',
    question: 'First president?',
    answer: 'Washington',
    explanation: 'George Washington.',
    tags: [],
  },
];

function createFetchMock() {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/api/questions')) {
      const categories = Array.from(new Set(HOME_TEST_QUESTIONS.map((q) => q.category))).sort();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions: HOME_TEST_QUESTIONS, categories }),
      } as Response);
    }

    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(
      (
        {
          children,
          layout: _layout,
          ...props
        }: React.HTMLAttributes<HTMLDivElement> & {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderHome() {
  return render(
    <GameProvider>
      <Home />
    </GameProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests for SNES-themed Home screen
// ---------------------------------------------------------------------------

describe('Home page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the Team Setup panel header', () => {
    renderHome();
    expect(screen.getByText('TEAM SETUP')).toBeDefined();
  });

  it('renders the start game button (disabled with no teams)', () => {
    renderHome();
    const startButton = screen.getByTestId('button-start-game');
    expect(startButton).toBeDefined();
    expect(startButton.hasAttribute('disabled')).toBe(true);
  });

  it('renders the admin button', () => {
    renderHome();
    const adminButton = screen.getByTestId('link-admin');
    expect(adminButton).toBeDefined();
  });

  it('shows empty state when no teams added', () => {
    renderHome();
    expect(screen.getByText('NO TEAMS YET')).toBeDefined();
  });

  it('renders the add team input', () => {
    renderHome();
    expect(screen.getByPlaceholderText('TEAM NAME...')).toBeDefined();
  });

  it('renders the TRIVIA CLASH title', () => {
    renderHome();
    expect(screen.getByText('TRIVIA CLASH')).toBeDefined();
  });

  it('warns when the selected setup needs more questions than are available', async () => {
    renderHome();

    const input = screen.getByPlaceholderText('Enter team name...');
    const form = input.closest('form');
    expect(form).not.toBeNull();

    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.submit(form!);

    fireEvent.change(input, { target: { value: 'Bravo' } });
    fireEvent.submit(form!);

    expect(await screen.findByTestId('warning-insufficient-questions')).toBeDefined();
  });
});
