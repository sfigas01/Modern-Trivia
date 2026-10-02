import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HostGame from './HostGame';
import JoinGame from './JoinGame';
import { GameProvider } from '@/lib/store';

// Pixel Host / Join (STE-231): HostGame.tsx and JoinGame.tsx render the pixel
// pages when VITE_PIXEL_UI is on.

const storage: Record<string, string> = {};
function stubLocalStorage() {
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
}

const mockSetLocation = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ params: {} as { code?: string } }));

vi.mock('@/lib/featureFlags', () => ({ MULTIPLAYER: true, THEME_ROUNDS: false, PIXEL_UI: true }));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
  useParams: () => route.params,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CATEGORIES = [
  'History & Geography',
  'Science & Nature',
  'Sports',
  'Entertainment & Pop Culture',
  'Food & Culture',
  'Technology',
  'Music',
];
const QUESTIONS = CATEGORIES.map((category, i) => ({
  id: `q${i}`,
  category,
  difficulty: 'Easy',
  question: `Q${i}?`,
  answer: 'A',
  explanation: '',
  tags: [],
}));

function createFetchMock() {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/questions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions: QUESTIONS, categories: CATEGORIES }),
      } as Response);
    }
    if (url.includes('/api/rooms')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 'ABCD2',
            playerId: '11111111-1111-4111-8111-111111111111',
            token: 'test-token',
          }),
      } as Response);
    }
    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GameProvider>{page}</GameProvider>
    </QueryClientProvider>
  );
}

function bodyOf(fetchMock: ReturnType<typeof createFetchMock>, path: string) {
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes(path));
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe('Pixel Host a Game', () => {
  beforeEach(() => {
    stubLocalStorage();
    localStorage.clear();
    mockSetLocation.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows All plus every category as tiles', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderPage(<HostGame />);
    expect(await screen.findByRole('heading', { name: 'Host a Game' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Music\s*\(\d+\)$/ })).toBeInTheDocument();
    for (const category of ['All', ...CATEGORIES]) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${category}\\s*\\(\\d+\\)$`) })
      ).toBeInTheDocument();
    }
  });

  it('creates a room with the chosen settings and opens it', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<HostGame />);

    const create = await screen.findByTestId('button-create-room');
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Sports\s*\(\d+\)$/ }));
    fireEvent.click(screen.getByRole('button', { name: '15 rounds' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Opponent dispute voting' }));
    fireEvent.click(create);

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith('/room/ABCD2'));
    expect(bodyOf(fetchMock, '/api/rooms')).toMatchObject({
      nickname: 'Steph',
      categories: ['Sports'],
      numRounds: 15,
      opponentDisputeVotingEnabled: true,
    });
  });

  it('links the title home', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderPage(<HostGame />);
    expect(await screen.findByRole('link', { name: 'Super Questly' })).toHaveAttribute('href', '/');
  });

  it('goes back home', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderPage(<HostGame />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(mockSetLocation).toHaveBeenCalledWith('/');
  });
});

describe('Pixel Join a Game', () => {
  beforeEach(() => {
    stubLocalStorage();
    localStorage.clear();
    mockSetLocation.mockClear();
    route.params = {};
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('joins with a typed code and nickname', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<JoinGame />);

    const join = await screen.findByTestId('button-join-room');
    fireEvent.change(screen.getByTestId('input-code'), { target: { value: 'abcde' } });
    expect(screen.getByTestId('input-code')).toHaveValue('ABCDE');
    expect(join).toBeDisabled();
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(join);

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith('/room/ABCDE'));
    expect(bodyOf(fetchMock, '/api/rooms/ABCDE/join')).toMatchObject({ nickname: 'Steph' });
  });

  it('pre-fills an invite code and focuses the nickname', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    route.params = { code: 'wxyz2' };
    renderPage(<JoinGame />);

    expect(await screen.findByTestId('input-code')).toHaveValue('WXYZ2');
    expect(screen.getByTestId('text-code-hint')).toHaveTextContent(/filled in from your invite/i);
    expect(screen.getByTestId('input-nickname')).toHaveFocus();
  });
});
