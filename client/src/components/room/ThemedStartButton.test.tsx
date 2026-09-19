import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemedStartButton } from './ThemedStartButton';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/guest-seen', () => ({ getGuestSeenIds: () => [] }));
vi.mock('@/lib/room-session', () => ({ getRoomSession: () => ({ token: 'tok' }) }));

function renderButton(props: { canStart?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemedStartButton code="ABCD2" theme="baseball" canStart={props.canStart ?? true} />
    </QueryClientProvider>
  );
}

describe('ThemedStartButton', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => cleanup());

  it('is disabled until there are enough players', () => {
    renderButton({ canStart: false });
    expect(screen.getByTestId('button-start-themed-game')).toBeDisabled();
    expect(screen.getByTestId('text-need-players')).toBeInTheDocument();
  });

  it('starts preparation and shows X-of-N progress', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/theme-start')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'preparing',
              ready: 0,
              total: 40,
              reused: 0,
              generated: 0,
              error: null,
            }),
        } as Response);
      }
      if (url.includes('/theme-progress')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'preparing',
              ready: 12,
              total: 40,
              reused: 4,
              generated: 8,
              error: null,
            }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderButton();
    fireEvent.click(screen.getByTestId('button-start-themed-game'));

    await waitFor(() => expect(screen.getByTestId('text-theme-progress')).toBeInTheDocument());
    expect(screen.getByTestId('text-theme-progress')).toHaveTextContent('12 of 40 ready');
    vi.unstubAllGlobals();
  });
});
