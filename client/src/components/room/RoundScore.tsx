import { toast } from 'sonner';
import { ArrowRight, Trophy } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ContinueRoomResponse, RoomSnapshot } from '@shared/models/rooms';

import { isRoomConflict } from '@/hooks/use-room';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type RoundScoreSnapshot = Extract<RoomSnapshot, { phase: 'ROUND_SCORE' }>;

export interface RoundScoreProps {
  snapshot: RoundScoreSnapshot;
  currentPlayerId: string;
  continueRound: UseMutationResult<ContinueRoomResponse, Error, void>;
  refetch: () => void;
}

export function RoundScore({ snapshot, currentPlayerId, continueRound, refetch }: RoundScoreProps) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score);

  function handleNextRound() {
    if (continueRound.isPending) return;
    continueRound.mutate(undefined, {
      onError: (error) => {
        if (isRoomConflict(error)) {
          refetch();
          return;
        }
        toast.error(error.message || 'Something went wrong. Please try again.');
      },
    });
  }

  return (
    <div className="w-full max-w-lg space-y-6 text-center">
      <div className="space-y-2">
        <Badge
          variant="outline"
          className="border-primary/40 text-primary flex items-center justify-center gap-2 mx-auto w-fit"
        >
          <Trophy className="w-4 h-4" />
          Round Complete
        </Badge>
        <h1 className="text-3xl font-bold">Round Scores</h1>
      </div>
      <Card className="border-white/10 bg-white/5 backdrop-blur-md">
        <CardContent className="p-6 space-y-3">
          {ranked.map((player, index) => (
            <div
              key={player.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              data-testid={`round-score-row-${player.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-primary">#{index + 1}</span>
                <span className="font-semibold">
                  {player.nickname}
                  {player.id === currentPlayerId && (
                    <span className="text-muted-foreground font-normal"> (you)</span>
                  )}
                </span>
              </div>
              <div className="text-right">
                <span className="font-mono text-xl font-bold">{player.score}</span>
                {player.lastRoundDelta !== 0 && (
                  <span
                    className={cn(
                      'ml-2 text-sm font-mono',
                      player.lastRoundDelta > 0 ? 'text-green-400' : 'text-red-400'
                    )}
                    data-testid={`round-score-delta-${player.id}`}
                  >
                    ({player.lastRoundDelta > 0 ? '+' : ''}
                    {player.lastRoundDelta})
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {isHost ? (
        <Button
          onClick={handleNextRound}
          disabled={continueRound.isPending}
          className="w-full h-14 text-lg font-bold"
          data-testid="button-next-round"
        >
          {continueRound.isPending ? 'Starting…' : 'Next Round'} <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      ) : (
        <p className="text-center text-muted-foreground" data-testid="text-waiting-host-round">
          Waiting for host…
        </p>
      )}
    </div>
  );
}
