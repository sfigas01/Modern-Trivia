import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HostGame from './HostGame';
import { GameProvider } from '@/lib/store';

// Themed games enabled for this suite.
vi.mock('@/lib/featureFlags', () => ({ MULTIPLAYER: true, THEME_ROUNDS: true }));

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
  });
}

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({ useLocation: () => ['/host', mockSetLocation] }));
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(
      (props: React.HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props} />
      )
    ),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

interface RoomRequestBody {
  categories: string[];
  theme?: string;
}
let lastCreateBody: RoomRequestBody | null = null;

function createFetchMock() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/api/theme/suggest')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ theme: 'baseball', categories: ['Sports'] }),
      } as Response);
    }
    if (url.includes('/api/questions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions: [], categories: [] }),
      } as Response);
    }
    if (url.includes('/api/rooms')) {
      lastCreateBody = JSON.parse((init?.body as string) ?? '{}');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ code: 'ABCD2', playerId: 'p1', token: 'tok' }),
      } as Response);
    }
    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

function renderHostGame() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GameProvider>
        <HostGame />
      </GameProvider>
    </QueryClientProvider>
  );
}

describe('HostGame — themed games (VITE_THEME_ROUNDS on)', () => {
  beforeEach(() => {
    stubLocalStorage();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    localStorage.clear();
    mockSetLocation.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    lastCreateBody = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the theme input when the flag is on', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderHostGame();
    expect(await screen.findByTestId('input-theme')).toBeInTheDocument();
    expect(screen.getByTestId('button-suggest-categories')).toBeInTheDocument();
  });

  it('suggests categories for a theme and applies them to the create request', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderHostGame();

    fireEvent.change(await screen.findByTestId('input-theme'), {
      target: { value: 'baseball' },
    });
    fireEvent.click(screen.getByTestId('button-suggest-categories'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-create-room'));

    await waitFor(() => expect(lastCreateBody).not.toBeNull());
    expect(lastCreateBody?.theme).toBe('baseball');
    expect(lastCreateBody?.categories).toContain('Sports');
  });
});
