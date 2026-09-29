import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import type { ThemeProgress, ThemeStartResponse } from '@shared/models/rooms';

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
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      // no JSON body
    }
    throw new Error(message);
  }
  return res.json() as Promise<ThemeStartResponse>;
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

export function ThemedStartButton({ code, theme, canStart }: ThemedStartButtonProps) {
  const [preparing, setPreparing] = useState(false);

  const start = useMutation({
    mutationFn: () => postThemeStart(code),
    onSuccess: (progress) => {
      setPreparing(true);
      if (progress.status === 'error') {
        setPreparing(false);
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

  const progress = progressQuery.data;
  // Preparation is terminal on error; the host can retry from the error panel.
  const isBusy = start.isPending || (preparing && progress?.status !== 'error');

  return (
    <div className="space-y-3">
      <Button
        className="w-full h-14 text-lg font-bold"
        disabled={!canStart || isBusy}
        onClick={() => {
          if (!canStart || isBusy) return;
          start.mutate();
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
          {progress.error ?? 'Themed preparation failed.'}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setPreparing(false);
              start.mutate();
            }}
          >
            Try again
          </button>
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
