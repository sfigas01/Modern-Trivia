import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    logout: vi.fn(),
    isLoggingOut: false,
  }),
}));

vi.mock('@/hooks/use-admin', () => ({
  useAdmin: () => ({
    isAdmin: false,
    isLoading: false,
    error: null,
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(
      ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      ),
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
    </GameProvider>,
  );
}

// ---------------------------------------------------------------------------
// BUG #1 REGRESSION: Category selection must be visible on the setup screen
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

  it('renders the Category section heading', async () => {
    renderHome();
    expect(await screen.findByText('Category')).toBeDefined();
  });

  it('renders the "All Categories" button', async () => {
    renderHome();
    // The Home page has a hardcoded "All Categories" button plus categories
    // from the store include "All". Use getAllByText to be resilient.
    const buttons = await screen.findAllByText(/All/);
    const allCategoriesBtn = buttons.find((el) => el.textContent === 'All Categories');
    expect(allCategoriesBtn).toBeDefined();
  });

  it('renders individual category buttons from loaded questions', async () => {
    renderHome();
    // Categories from the mocked questions: Geography, Science, History
    expect(await screen.findByText('Geography')).toBeDefined();
    expect(await screen.findByText('Science')).toBeDefined();
    expect(await screen.findByText('History')).toBeDefined();
  });

  it('renders the Team Setup section', () => {
    renderHome();
    expect(screen.getByText('Team Setup')).toBeDefined();
  });

  it('renders the start game button (disabled with no teams)', () => {
    renderHome();
    const startButton = screen.getByTestId('button-start-game');
    expect(startButton).toBeDefined();
    expect(startButton.hasAttribute('disabled')).toBe(true);
  });

  it('renders round selection buttons', () => {
    renderHome();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('15')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
  });
});
