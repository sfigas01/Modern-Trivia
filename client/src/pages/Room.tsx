import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { QUESTIONS_PER_TEAM_ROTATION } from '@shared/lib/answers';

import { FinalResults } from '@/components/room/FinalResults';
import { Lobby } from '@/components/room/Lobby';
import { PlayerRoster } from '@/components/room/PlayerRoster';
import { QuestionView } from '@/components/room/QuestionView';
import { RevealView } from '@/components/room/RevealView';
import { RoomAbandoned } from '@/components/room/RoomAbandoned';
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
  const {
    snapshot,
    isLoading,
    isDisconnected,
    error,
    start,
    answer,
    advance,
    continueRound,
    skip,
    end,
    refetch,
  } = useRoom(code, { enabled: !!session });

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

  const handleDismissHandoff = useCallback(() => setHandoffPlayer(null), []);

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

  if (snapshot.status === 'abandoned') {
    return <RoomAbandoned snapshot={snapshot} />;
  }

  const showProgress = snapshot.phase === 'QUESTION' || snapshot.phase === 'REVEAL';
  const activePlayerCount = snapshot.players.filter((player) => !player.leftAt).length;
  const totalQuestions = snapshot.numRounds * activePlayerCount * QUESTIONS_PER_TEAM_ROTATION;
  const progressPercent =
    totalQuestions > 0
      ? Math.min(100, Math.max(0, (snapshot.currentQuestionIndex / totalQuestions) * 100))
      : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
      {showProgress &&
        (progressPercent !== null ? (
          <div
            className="fixed top-0 left-0 w-full h-2 bg-white/5 z-30"
            data-testid="multiplayer-progress-bar"
          >
            <motion.div
              className="h-full bg-primary"
              initial={{ width: '0%' }}
              animate={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : (
          <p
            className="fixed top-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground"
            data-testid="text-question-counter"
          >
            Question {snapshot.currentQuestionIndex + 1}
          </p>
        ))}

      {isDisconnected && (
        <div
          className={`fixed left-0 w-full z-40 py-2 text-center text-sm font-medium bg-yellow-500/90 text-black ${
            showProgress ? 'top-2' : 'top-0'
          }`}
          data-testid="text-disconnected"
          aria-live="polite"
        >
          Connection lost. Reconnecting…
        </div>
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
              skip={skip}
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
          <TurnHandoff nickname={handoffPlayer.nickname} onDismiss={handleDismissHandoff} />
        )}
      </AnimatePresence>
    </div>
  );
}
