import { useLocation } from 'wouter';
import type { RoomSnapshot } from '@shared/models/rooms';

import { clearRoomSession } from '@/lib/room-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type GameOverSnapshot = Extract<RoomSnapshot, { phase: 'GAME_OVER' }>;

export interface FinalResultsProps {
  snapshot: GameOverSnapshot;
  currentPlayerId: string;
}

export function FinalResults({ snapshot, currentPlayerId }: FinalResultsProps) {
  const [, setLocation] = useLocation();
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;
  const winners = ranked.filter((p) => p.score === topScore);
  const isTie = winners.length > 1;

  function handleBackToHome() {
    clearRoomSession(snapshot.code);
    setLocation('/');
  }

  return (
    <div className="w-full max-w-lg space-y-6 text-center">
      <div className="space-y-2">
        <Badge variant="outline" className="border-primary/40 text-primary">
          Game Over
        </Badge>
        <h1 className="text-4xl font-bold">Final Results</h1>
        {isTie ? (
          <p className="text-muted-foreground" data-testid="text-winner">
            It's a tie:{' '}
            <span className="text-primary font-semibold">
              {winners.map((w) => w.nickname).join(' & ')}
            </span>
          </p>
        ) : (
          ranked[0] && (
            <p className="text-muted-foreground" data-testid="text-winner">
              Winner: <span className="text-primary font-semibold">{ranked[0].nickname}</span>
            </p>
          )
        )}
      </div>
      <Card className="border-white/10 bg-white/5 backdrop-blur-md">
        <CardContent className="p-6 space-y-3">
          {ranked.map((player, index) => (
            <div
              key={player.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              data-testid={`final-result-row-${player.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">#{index + 1}</span>
                <span className={`font-semibold${player.leftAt ? ' text-muted-foreground' : ''}`}>
                  {player.nickname}
                  {player.id === currentPlayerId && (
                    <span className="text-muted-foreground font-normal"> (you)</span>
                  )}
                  {player.leftAt && (
                    <span className="text-muted-foreground font-normal"> (left)</span>
                  )}
                </span>
              </div>
              <span className="font-mono text-lg">{player.score}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Button
        onClick={handleBackToHome}
        className="w-full h-14 text-lg font-bold"
        data-testid="button-back-home"
      >
        Back to Home
      </Button>
    </div>
  );
}
