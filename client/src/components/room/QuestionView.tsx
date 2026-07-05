import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  AnswerRoomRequest,
  AnswerRoomResponse,
  RoomSnapshot,
  SkipRoomResponse,
} from '@shared/models/rooms';

import { isRoomConflict } from '@/hooks/use-room';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, getDifficultyBadgeClass } from '@/lib/utils';

type QuestionSnapshot = Extract<RoomSnapshot, { phase: 'QUESTION' }>;

// Mirrors the server's SKIP_THRESHOLD_MS (server/routes.rooms.ts) so the
// button only appears once the skip mutation would actually succeed.
const SKIP_THRESHOLD_MS = 60_000;

export interface QuestionViewProps {
  snapshot: QuestionSnapshot;
  currentPlayerId: string;
  answer: UseMutationResult<AnswerRoomResponse, Error, AnswerRoomRequest>;
  skip: UseMutationResult<SkipRoomResponse, Error, void>;
  refetch: () => void;
}

export function QuestionView({
  snapshot,
  currentPlayerId,
  answer,
  skip,
  refetch,
}: QuestionViewProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isMyTurn = snapshot.activePlayerId === currentPlayerId;
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const activePlayer = snapshot.players.find((player) => player.id === snapshot.activePlayerId);
  const activePlayerStale = activePlayer
    ? Date.now() - new Date(activePlayer.lastSeenAt).getTime() > SKIP_THRESHOLD_MS
    : false;
  const canSkip = isHost && activePlayerStale;

  useEffect(() => {
    setValue('');
  }, [snapshot.currentQuestion.id]);

  function handleActionError(error: Error) {
    if (isRoomConflict(error)) {
      refetch();
      return;
    }
    toast.error(error.message || 'Something went wrong. Please try again.');
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || answer.isPending) return;
    answer.mutate({ answer: trimmed }, { onError: handleActionError });
  }

  function handlePass() {
    if (answer.isPending) return;
    answer.mutate({ answer: null }, { onError: handleActionError });
  }

  function handleSkip() {
    if (skip.isPending) return;
    skip.mutate(undefined, { onError: handleActionError });
  }

  return (
    <div className="w-full max-w-lg space-y-4">
      {isMyTurn ? (
        <Badge
          variant="outline"
          className="border-primary/40 text-primary flex items-center justify-center gap-2 w-full py-2"
          data-testid="badge-your-turn"
        >
          Your turn
        </Badge>
      ) : (
        <p
          className="text-center text-muted-foreground animate-pulse"
          data-testid="text-waiting-turn"
        >
          Waiting for {activePlayer?.nickname ?? 'player'} to answer…
        </p>
      )}

      {canSkip && (
        <Button
          variant="outline"
          onClick={handleSkip}
          disabled={skip.isPending}
          className="w-full border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10"
          data-testid="button-skip-turn"
        >
          {skip.isPending ? 'Skipping…' : `Skip ${activePlayer?.nickname ?? 'their'} turn`}
        </Button>
      )}

      <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
        <CardContent className="p-6 md:p-8 space-y-4">
          <div className="flex flex-wrap gap-2 justify-center">
            <Badge variant="outline" className="border-white/20 bg-white/5">
              {snapshot.currentQuestion.category}
            </Badge>
            <Badge
              className={cn(
                'border-none',
                getDifficultyBadgeClass(snapshot.currentQuestion.difficulty)
              )}
            >
              {snapshot.currentQuestion.difficulty}
            </Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold leading-tight text-center font-display">
            {snapshot.currentQuestion.question}
          </h1>
        </CardContent>
      </Card>

      {isMyTurn && (
        <div className="space-y-3">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() =>
              inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="Type your answer…"
            className="h-14 text-lg text-center bg-white/5 border-white/10 focus:border-primary/50"
            autoFocus
            disabled={answer.isPending}
            data-testid="input-answer"
          />
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant="secondary"
              onClick={handlePass}
              disabled={answer.isPending}
              className="h-12"
              data-testid="button-pass"
            >
              Pass
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!value.trim() || answer.isPending}
              className="col-span-2 h-12 font-bold"
              data-testid="button-submit-answer"
            >
              {answer.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
