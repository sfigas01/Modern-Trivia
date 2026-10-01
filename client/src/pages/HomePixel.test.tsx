import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Home from './Home';
import { GameProvider } from '@/lib/store';
import { saveRoomSession } from '@/lib/room-session';

// Pixel Home (STE-132): Home.tsx renders HomePixel when VITE_PIXEL_UI is on.

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
  key: (index: number) => Object.keys(storage)[index] ?? null,
  get length() {
    return Object.keys(storage).length;
  },
});

const QUESTIONS = [
  {
    id: 'q1',
    category: 'Geography',
    difficulty: 'Easy',
    question: 'Q1?',
    answer: 'A',
    explanation: '',
    tags: [],
  },
  {
    id: 'q2',
    category: 'Science',
    difficulty: 'Medium',
    question: 'Q2?',
    answer: 'B',
    explanation: '',
    tags: [],
  },
];

function createFetchMock() {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/questions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions: QUESTIONS, categories: ['Geography', 'Science'] }),
      } as Response);
    }
    if (url.includes('/api/rooms/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'active' }),
      } as Response);
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  });
}

const flags = vi.hoisted(() => ({ MULTIPLAYER: false, PIXEL_UI: true }));
const mockSetLocation = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ isAuthenticated: false, isAdmin: false }));

vi.mock('@/lib/featureFlags', () => flags);

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: auth.isAuthenticated ? { email: 'host@example.com' } : null,
    isLoading: false,
    isAuthenticated: auth.isAuthenticated,
    logout: vi.fn(),
    isLoggingOut: false,
  }),
}));

vi.mock('@/hooks/use-admin', () => ({
  useAdmin: () => ({ isAdmin: auth.isAdmin, isLoading: false, error: null }),
}));

function renderHome() {
  return render(
    <GameProvider>
      <Home />
    </GameProvider>
  );
}

async function addTeam(name: string) {
  fireEvent.change(screen.getByLabelText('Team name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Team' }));
  await screen.findByText(name);
}

describe('Pixel Home (VITE_PIXEL_UI on)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetLocation.mockClear();
    flags.MULTIPLAYER = false;
    auth.isAuthenticated = false;
    auth.isAdmin = false;
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
  });

  describe('solo setup', () => {
    it('renders the pixel wordmark and Team Setup panel', async () => {
      renderHome();
      expect(await screen.findByRole('heading', { name: 'Super Questly' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Team Setup' })).toBeInTheDocument();
      expect(screen.getByText('No teams added yet')).toBeInTheDocument();
    });

    it('adds and removes teams', async () => {
      renderHome();
      await screen.findByLabelText('Team name');
      await addTeam('Owls');
      fireEvent.click(screen.getByRole('button', { name: 'Remove Owls' }));
      expect(screen.queryByText('Owls')).toBeNull();
    });

    it('enables Start Game only once two teams exist', async () => {
      renderHome();
      const start = await screen.findByTestId('button-start-game');
      expect(start).toBeDisabled();
      await addTeam('Owls');
      expect(start).toBeDisabled();
      await addTeam('Foxes');
      expect(start).toBeEnabled();
    });

    it('marks the selected round count and category as pressed', async () => {
      renderHome();
      const ten = await screen.findByRole('button', { name: '10 rounds' });
      fireEvent.click(ten);
      expect(ten).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '5 rounds' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      const geography = await screen.findByRole('button', { name: /Geography\s*\(\d+\)/ });
      expect(screen.getByRole('button', { name: /^All\s*\(\d+\)$/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      fireEvent.click(geography);
      expect(geography).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows Sign In when signed out', async () => {
      renderHome();
      expect(await screen.findByTestId('button-login')).toBeInTheDocument();
      expect(screen.queryByTestId('link-admin')).toBeNull();
    });

    it('shows Admin and Sign Out for a signed-in admin', async () => {
      auth.isAuthenticated = true;
      auth.isAdmin = true;
      renderHome();
      fireEvent.click(await screen.findByTestId('link-admin'));
      expect(mockSetLocation).toHaveBeenCalledWith('/admin');
      expect(screen.getByTestId('button-logout')).toHaveTextContent('Sign Out (host)');
    });
  });

  describe('mode chooser (VITE_MULTIPLAYER on)', () => {
    beforeEach(() => {
      flags.MULTIPLAYER = true;
    });

    it('renders the three modes and routes host and join', async () => {
      renderHome();
      fireEvent.click(await screen.findByTestId('button-mode-host'));
      expect(mockSetLocation).toHaveBeenCalledWith('/host');
      fireEvent.click(screen.getByTestId('button-mode-join'));
      expect(mockSetLocation).toHaveBeenCalledWith('/join');
      expect(screen.queryByRole('heading', { name: 'Team Setup' })).toBeNull();
    });

    it('opens the pixel solo setup from Play Solo', async () => {
      renderHome();
      fireEvent.click(await screen.findByTestId('button-mode-solo'));
      expect(await screen.findByRole('heading', { name: 'Team Setup' })).toBeInTheDocument();
    });

    it('shows the tagline and a Sign In button', async () => {
      renderHome();
      expect(await screen.findByText('Trivia that everyone can play')).toBeInTheDocument();
      expect(screen.getByTestId('button-login')).toBeInTheDocument();
    });

    it('shows Sign Out for a signed-in player', async () => {
      auth.isAuthenticated = true;
      renderHome();
      expect(await screen.findByTestId('button-logout')).toHaveTextContent('Sign Out (host)');
    });

    it('offers to rejoin an active stored room', async () => {
      saveRoomSession({ code: 'ABCDE', playerId: 'player-1', token: 'token-1' });
      renderHome();
      const rejoin = await screen.findByTestId('button-rejoin-room');
      expect(rejoin).toHaveTextContent('ABCDE');
      expect(rejoin).toHaveAttribute('href', '/room/ABCDE');
    });
  });
});
