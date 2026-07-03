import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import HostGame from './HostGame';
import { GameProvider } from '@/lib/store';
import { getRoomSession } from '@/lib/room-session';

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

const mockSetLocation = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/host', mockSetLocation],
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(
      (props: React.HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props} />
      )
    ),
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const QUESTIONS = [
  {
    id: 'q1',
    category: 'Science & Nature',
    difficulty: 'Easy',
    question: 'H2O?',
    answer: 'Water',
    explanation: '',
    tags: [],
  },
];

function createFetchMock(overrides?: { createRoom?: () => Promise<Response> }) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/api/questions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ questions: QUESTIONS, categories: ['Science & Nature'] }),
      } as Response);
    }

    if (url.includes('/api/rooms')) {
      if (overrides?.createRoom) return overrides.createRoom();
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

describe('HostGame', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetLocation.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('disables the create room button until a nickname is entered', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderHostGame();

    const createButton = await screen.findByTestId('button-create-room');
    expect(createButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: '   ' } });
    expect(createButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    expect(createButton.hasAttribute('disabled')).toBe(false);
  });

  it('shows a spinner while the create room request is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', createFetchMock({ createRoom: () => pending }));
    renderHostGame();

    fireEvent.change(await screen.findByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-create-room'));

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeDefined();
    expect(screen.getByTestId('button-create-room').hasAttribute('disabled')).toBe(true);

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 'ABCD2',
          playerId: '11111111-1111-4111-8111-111111111111',
          token: 'test-token',
        }),
    } as Response);

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalled());
  });

  it('shows a toast and keeps the form editable when the server returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        createRoom: () =>
          Promise.resolve({
            ok: false,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({ message: 'Room could not be created' }),
          } as Response),
      })
    );
    renderHostGame();

    fireEvent.change(await screen.findByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-create-room'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Room could not be created'));

    const nicknameInput = screen.getByTestId('input-nickname') as HTMLInputElement;
    expect(nicknameInput.hasAttribute('disabled')).toBe(false);
    expect(nicknameInput.value).toBe('Steph');
    expect(screen.getByTestId('button-create-room').hasAttribute('disabled')).toBe(false);
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('saves the room session and redirects to /room/:code on success', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderHostGame();

    fireEvent.change(await screen.findByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-create-room'));

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith('/room/ABCD2'));
    expect(getRoomSession('ABCD2')).toEqual({
      code: 'ABCD2',
      playerId: '11111111-1111-4111-8111-111111111111',
      token: 'test-token',
    });
  });
});
