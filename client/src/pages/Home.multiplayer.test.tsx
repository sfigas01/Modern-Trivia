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

function createFetchMock() {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ questions: [], categories: [] }),
    } as Response)
  );
}

// ---------------------------------------------------------------------------
// Mocks — same as Home.test.tsx, but with MULTIPLAYER enabled
// ---------------------------------------------------------------------------

const mockSetLocation = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
}));

vi.mock('@/lib/featureFlags', () => ({
  MULTIPLAYER: true,
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

function renderHome() {
  return render(
    <GameProvider>
      <Home />
    </GameProvider>
  );
}

describe('Home page with VITE_MULTIPLAYER enabled', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetLocation.mockClear();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the mode chooser instead of the solo setup screen', () => {
    renderHome();
    expect(screen.getByTestId('button-mode-solo')).toBeDefined();
    expect(screen.getByTestId('button-mode-host')).toBeDefined();
    expect(screen.getByTestId('button-mode-join')).toBeDefined();
    expect(screen.queryByText('Team Setup')).toBeNull();
  });

  it('navigates to /host when "Host a Game" is clicked', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('button-mode-host'));
    expect(mockSetLocation).toHaveBeenCalledWith('/host');
  });

  it('navigates to /join when "Join a Game" is clicked', () => {
    renderHome();
    fireEvent.click(screen.getByTestId('button-mode-join'));
    expect(mockSetLocation).toHaveBeenCalledWith('/join');
  });

  it('shows the existing solo setup flow after clicking "Play Solo"', async () => {
    renderHome();
    fireEvent.click(screen.getByTestId('button-mode-solo'));
    expect(await screen.findByText('Team Setup')).toBeDefined();
  });
});
