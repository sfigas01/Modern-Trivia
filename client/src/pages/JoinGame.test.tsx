import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import JoinGame from './JoinGame';
import { getRoomSession } from '@/lib/room-session';

// Stub localStorage for jsdom compatibility
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
let mockParams: { code?: string } = {};

vi.mock('wouter', () => ({
  useLocation: () => ['/join', mockSetLocation],
  useParams: () => mockParams,
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

function createFetchMock(overrides?: { joinRoom?: () => Promise<Response> }) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/join')) {
      if (overrides?.joinRoom) return overrides.joinRoom();
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            playerId: '11111111-1111-4111-8111-111111111111',
            token: 'test-token',
            snapshot: {},
          }),
      } as Response);
    }

    return Promise.reject(new Error(`Unhandled fetch: ${url}`));
  });
}

function renderJoinGame() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JoinGame />
    </QueryClientProvider>
  );
}

describe('JoinGame', () => {
  beforeEach(() => {
    stubLocalStorage();
    localStorage.clear();
    mockSetLocation.mockClear();
    toastError.mockClear();
    mockParams = {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('disables the join button until code and nickname are valid', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderJoinGame();

    const joinButton = await screen.findByTestId('button-join-room');
    expect(joinButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('input-code'), { target: { value: 'ABCD' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    expect(joinButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('input-code'), { target: { value: 'ABCDE' } });
    expect(joinButton).not.toBeDisabled();

    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: '   ' } });
    expect(joinButton).toBeDisabled();
  });

  it('auto-uppercases the room code as the user types', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderJoinGame();

    const codeInput = (await screen.findByTestId('input-code')) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'abcde' } });

    expect(codeInput.value).toBe('ABCDE');
  });

  it('prefills the room code from the route param', async () => {
    mockParams = { code: 'wxyz2' };
    vi.stubGlobal('fetch', createFetchMock());
    renderJoinGame();

    const codeInput = (await screen.findByTestId('input-code')) as HTMLInputElement;
    expect(codeInput.value).toBe('WXYZ2');
  });

  it('shows a spinner while the join request is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', createFetchMock({ joinRoom: () => pending }));
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeDefined();
    expect(screen.getByTestId('button-join-room')).toBeDisabled();

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          playerId: '11111111-1111-4111-8111-111111111111',
          token: 'test-token',
          snapshot: {},
        }),
    } as Response);

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalled());
  });

  it('shows a toast and keeps the form editable when the room is not found', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        joinRoom: () =>
          Promise.resolve({
            ok: false,
            statusText: 'Not Found',
            json: () => Promise.resolve({ message: 'Room not found' }),
          } as Response),
      })
    );
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Room not found'));

    const nicknameInput = screen.getByTestId('input-nickname') as HTMLInputElement;
    expect(nicknameInput).not.toBeDisabled();
    expect(nicknameInput.value).toBe('Steph');
    expect(screen.getByTestId('button-join-room')).not.toBeDisabled();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('shows a toast when the room is full', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        joinRoom: () =>
          Promise.resolve({
            ok: false,
            statusText: 'Conflict',
            json: () => Promise.resolve({ message: 'Room is full' }),
          } as Response),
      })
    );
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Room is full'));
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('shows a toast when the nickname is already taken', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        joinRoom: () =>
          Promise.resolve({
            ok: false,
            statusText: 'Conflict',
            json: () => Promise.resolve({ message: 'Nickname is already taken' }),
          } as Response),
      })
    );
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Nickname is already taken'));
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('shows a toast when the game has already started', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        joinRoom: () =>
          Promise.resolve({
            ok: false,
            statusText: 'Conflict',
            json: () => Promise.resolve({ message: 'Game has already started' }),
          } as Response),
      })
    );
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Game has already started'));
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it('saves the room session and redirects to /room/:code on success', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    renderJoinGame();

    fireEvent.change(await screen.findByTestId('input-code'), { target: { value: 'ABCDE' } });
    fireEvent.change(screen.getByTestId('input-nickname'), { target: { value: 'Steph' } });
    fireEvent.click(screen.getByTestId('button-join-room'));

    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith('/room/ABCDE'));
    expect(getRoomSession('ABCDE')).toEqual({
      code: 'ABCDE',
      playerId: '11111111-1111-4111-8111-111111111111',
      token: 'test-token',
    });
  });
});
