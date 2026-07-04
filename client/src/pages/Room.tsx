import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { AnimatePresence } from 'framer-motion';

import { FinalResults } from '@/components/room/FinalResults';
import { Lobby } from '@/components/room/Lobby';
import { PlayerRoster } from '@/components/room/PlayerRoster';
import { QuestionView } from '@/components/room/QuestionView';
import { RevealView } from '@/components/room/RevealView';
import { RoundScore } from '@/components/room/RoundScore';
import { TurnHandoff } from '@/components/room/TurnHandoff';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useRoom } from '@/hooks/use-room';
import { getRoomSession } from '@/lib/room-session';
import type { RoomPlayerSnapshot } from '@shared/models/rooms';

export default function Room() {
  const { code } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const session = useMemo(() => getRoomSession(code), [code]);
  const { snapshot, isLoading, isDisconnected, error, start, answer, advance, continueRound, end, refetch } =
    useRoom(code, { enabled: !!session });

  const [handoffPlayer, setHandoffPlayer] = useState<RoomPlayerSnapshot | null>(null);
  const prevActivePlayerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      setLocation('/');
    }
  }, [session, setLocation]);

  // Only surface the interstitial for a genuine handoff (an active-player
  // change while already mid-game) — skip the very first turn assignment.
  useEffect(() => {
    if (!snapshot) return;
    const prevActivePlayerId = prevActivePlayerRef.current;
    prevActivePlayerRef.current = snapshot.activePlayerId;

    if (snapshot.phase !== 'QUESTION') return;
    if (prevActivePlayerId === null || prevActivePlayerId === snapshot.activePlayerId) return;

    const player = snapshot.players.find((p) => p.id === snapshot.activePlayerId);
    if (player) setHandoffPlayer(player);
  }, [snapshot]);

  if (!session) {
    return null;
  }

  if (isLoading && !snapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
      {isDisconnected && (
        <p className="text-sm text-yellow-400" data-testid="text-disconnected" aria-live="polite">
          Connection lost. Reconnecting…
        </p>
      )}

      {snapshot.phase === 'LOBBY' && (
        <Lobby snapshot={snapshot} currentPlayerId={session.playerId} start={start} end={end} />
      )}

      {snapshot.phase !== 'LOBBY' && (
        <div className="w-full max-w-lg space-y-4">
          <Card className="border-white/10 bg-white/5 backdrop-blur-md">
            <CardContent className="pt-4">
              <PlayerRoster
                players={snapshot.players}
                currentPlayerId={session.playerId}
                activePlayerId={snapshot.activePlayerId}
              />
            </CardContent>
          </Card>

          {snapshot.phase === 'QUESTION' && (
            <QuestionView
              snapshot={snapshot}
              currentPlayerId={session.playerId}
              answer={answer}
              refetch={refetch}
            />
          )}

          {snapshot.phase === 'REVEAL' && (
            <RevealView
              snapshot={snapshot}
              currentPlayerId={session.playerId}
              advance={advance}
              refetch={refetch}
            />
          )}

          {snapshot.phase === 'ROUND_SCORE' && (
            <RoundScore
              snapshot={snapshot}
              currentPlayerId={session.playerId}
              continueRound={continueRound}
              refetch={refetch}
            />
          )}

          {snapshot.phase === 'GAME_OVER' && (
            <FinalResults snapshot={snapshot} currentPlayerId={session.playerId} />
          )}
        </div>
      )}

      <AnimatePresence>
        {handoffPlayer && (
          <TurnHandoff nickname={handoffPlayer.nickname} onDismiss={() => setHandoffPlayer(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
