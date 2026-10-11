import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import {
  themeStartResponseSchema,
  type ThemeProgress,
  type ThemeStartResponse,
} from '@shared/models/rooms';

import { getGuestSeenIds } from '@/lib/guest-seen';
import { getRoomSession } from '@/lib/room-session';
import { Button } from '@/components/ui/button';

// Self-contained themed-start control (STE-167 lean MVP). Kept separate from the
// shared Lobby markup so the STE-128 redesign can restyle the lobby without
// touching themed logic. Kicks off best-effort background preparation and polls
// server-authoritative progress for the "generating… X of N ready" indicator;
// the room's own snapshot poll flips the phase to QUESTION when ready.

const PROGRESS_POLL_MS = 1500;

function authHeaders(code: string): HeadersInit {
  const session = getRoomSession(code);
  return session ? { 'X-Player-Token': session.token } : {};
}

async function postThemeStart(code: string): Promise<ThemeStartResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/theme-start`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(code) },
    body: JSON.stringify({ excludeQuestionIds: getGuestSeenIds() }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // no JSON body
  }
  if (!res.ok) {
    const shortfall = themeStartResponseSchema.safeParse(data);
    if (shortfall.success && shortfall.data.status === 'error') return shortfall.data;
    const message =
      typeof (data as { message?: unknown } | undefined)?.message === 'string'
        ? (data as { message: string }).message
        : res.statusText;
    throw new Error(message);
  }
  return themeStartResponseSchema.parse(data);
}

async function fetchThemeProgress(code: string): Promise<ThemeProgress> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/theme-progress`, {
    credentials: 'include',
    headers: authHeaders(code),
  });
  if (!res.ok) throw new Error('progress unavailable');
  return res.json() as Promise<ThemeProgress>;
}

export interface ThemedStartButtonProps {
  code: string;
  theme: string;
  canStart: boolean;
}

// Themed-game start and generation progress, shared by the classic and pixel
// (VITE_PIXEL_UI) lobby controls.
export function useThemedStart({ code }: ThemedStartButtonProps) {
  const [preparing, setPreparing] = useState(false);
  const [startProgress, setStartProgress] = useState<ThemeStartResponse>();

  const start = useMutation({
    mutationFn: () => postThemeStart(code),
    onSuccess: (progress) => {
      setStartProgress(progress);
      setPreparing(progress.status !== 'error');
      if (progress.status === 'error') {
        toast.error(progress.error ?? 'Themed preparation failed.');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start themed game. Please try again.');
    },
  });

  const progressQuery = useQuery({
    queryKey: ['theme-progress', code],
    queryFn: () => fetchThemeProgress(code),
    enabled: preparing,
    refetchInterval: (query) =>
      query.state.data?.status === 'preparing' ? PROGRESS_POLL_MS : false,
  });

  const progress = progressQuery.data ?? startProgress;
  const hasTerminalError = progress?.status === 'error';
  const isBusy = start.isPending || (preparing && progress?.status !== 'error');

  return {
    progress,
    preparing,
    isBusy,
    hasTerminalError,
    startGame: () => start.mutate(),
  };
}

export function ThemedStartButton(props: ThemedStartButtonProps) {
  const { theme, canStart } = props;
  const { progress, preparing, isBusy, hasTerminalError, startGame } = useThemedStart(props);

  return (
    <div className="space-y-3">
      <Button
        className="w-full h-14 text-lg font-bold"
        disabled={!canStart || isBusy || hasTerminalError}
        onClick={() => {
          if (!canStart || isBusy || hasTerminalError) return;
          startGame();
        }}
        data-testid="button-start-themed-game"
      >
        <Sparkles className="w-5 h-5 mr-2" />
        {isBusy ? 'Generating…' : 'Start Themed Game'}
      </Button>

      {preparing && progress && progress.status !== 'error' && (
        <div
          className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center text-sm"
          aria-live="polite"
          data-testid="text-theme-progress"
        >
          <div className="font-medium">
            Generating &ldquo;{theme}&rdquo; game… {progress.ready} of {progress.total} ready
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {progress.reused} reused · {progress.generated} newly written
          </div>
        </div>
      )}

      {progress?.status === 'error' && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-center text-sm"
          aria-live="polite"
          data-testid="text-theme-error"
        >
          {progress.error ?? 'Themed preparation failed.'}
        </div>
      )}

      {!canStart && (
        <p className="text-center text-sm text-muted-foreground" data-testid="text-need-players">
          Need at least 2 players
        </p>
      )}
    </div>
  );
}
