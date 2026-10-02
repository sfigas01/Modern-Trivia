import { QUESTIONS_PER_TEAM_ROTATION } from '@shared/lib/answers';
import type { RoomPlayerSnapshot } from '@shared/models/rooms';

import type { useRoom } from '@/hooks/use-room';
import type { RoomSession } from '@/lib/room-session';
import { PixelAvatar, PixelButton, PixelFrame, PixelScreen } from '@/components/pixel/Pixel';
import { PixelLoading, PixelProgress } from '@/components/pixel/Game';
import PixelLobby from './PixelLobby';
import {
  PixelDisputeVoteView,
  PixelFinalResults,
  PixelLeaveConfirmModal,
  PixelQuestionView,
  PixelRevealView,
  PixelRoomAbandoned,
  PixelRoundScore,
  PixelTurnHandoff,
} from './PixelRoomViews';

type RoomState = ReturnType<typeof useRoom>;

export interface PixelRoomProps {
  room: RoomState;
  session: RoomSession;
  handoffPlayer: RoomPlayerSnapshot | null;
  onDismissHandoff: () => void;
  showLeaveModal: boolean;
  setShowLeaveModal: (open: boolean) => void;
  onLeaveConfirm: () => void;
}

// Pixel-art multiplayer room (STE-128), rendered by Room.tsx when VITE_PIXEL_UI
// is on: loading and error states, the lobby, every in-game phase, and the
// room's overlays. Each view reuses its classic hook.
export default function PixelRoom({
  room,
  session,
  handoffPlayer,
  onDismissHandoff,
  showLeaveModal,
  setShowLeaveModal,
  onLeaveConfirm,
}: PixelRoomProps) {
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
    leave,
    awardDispute,
    submitDispute,
    castDisputeVote,
    cancelDisputeVote,
    refetch,
  } = room;

  if (isLoading && !snapshot) {
    return (
      <PixelScreen>
        <PixelLoading label="Joining room..." />
      </PixelScreen>
    );
  }

  if (error && !snapshot) {
    return (
      <PixelScreen>
        <PixelFrame title="Something went wrong">
          <p className="tc-hint">{error.message}</p>
        </PixelFrame>
      </PixelScreen>
    );
  }

  if (!snapshot) return null;

  if (snapshot.status === 'abandoned') {
    return <PixelRoomAbandoned snapshot={snapshot} />;
  }

  if (snapshot.phase === 'LOBBY') {
    return (
      <PixelLobby
        snapshot={snapshot}
        currentPlayerId={session.playerId}
        start={start}
        end={end}
        leave={leave}
        isDisconnected={isDisconnected}
      />
    );
  }

  const playerId = session.playerId;
  const showProgress =
    snapshot.phase === 'QUESTION' ||
    snapshot.phase === 'REVEAL' ||
    snapshot.phase === 'DISPUTE_VOTE';
  const activePlayerCount = snapshot.players.filter((player) => !player.leftAt).length;
  const totalQuestions = snapshot.numRounds * activePlayerCount * QUESTIONS_PER_TEAM_ROTATION;
  const progressPercent =
    totalQuestions > 0
      ? Math.min(100, Math.max(0, (snapshot.currentQuestionIndex / totalQuestions) * 100))
      : null;

  return (
    <PixelScreen wide>
      {isDisconnected && (
        <div className="tc-banner" data-testid="text-disconnected" aria-live="polite">
          Connection lost. Reconnecting…
        </div>
      )}

      <div className="tc-topbar">
        {showProgress &&
          (progressPercent !== null ? (
            <PixelProgress value={progressPercent} testId="multiplayer-progress-bar" />
          ) : (
            <p className="tc-tagline" data-testid="text-question-counter">
              Question {snapshot.currentQuestionIndex + 1}
            </p>
          ))}

        {snapshot.phase !== 'GAME_OVER' && (
          <PixelButton
            variant="stone"
            size="sm"
            onClick={() => setShowLeaveModal(true)}
            disabled={leave.isPending}
            aria-label="Leave game"
            data-testid="button-leave-game"
          >
            Exit
          </PixelButton>
        )}
      </div>

      {snapshot.phase === 'QUESTION' && (
        <PixelQuestionView
          snapshot={snapshot}
          currentPlayerId={playerId}
          answer={answer}
          skip={skip}
          refetch={refetch}
        />
      )}
      {snapshot.phase === 'REVEAL' && (
        <PixelRevealView
          snapshot={snapshot}
          currentPlayerId={playerId}
          advance={advance}
          awardDispute={awardDispute}
          submitDispute={submitDispute}
          refetch={refetch}
        />
      )}
      {snapshot.phase === 'DISPUTE_VOTE' && (
        <PixelDisputeVoteView
          snapshot={snapshot}
          currentPlayerId={playerId}
          castDisputeVote={castDisputeVote}
          cancelDisputeVote={cancelDisputeVote}
          refetch={refetch}
        />
      )}
      {snapshot.phase === 'ROUND_SCORE' && (
        <PixelRoundScore
          snapshot={snapshot}
          currentPlayerId={playerId}
          continueRound={continueRound}
          refetch={refetch}
        />
      )}
      {snapshot.phase === 'GAME_OVER' && (
        <PixelFinalResults snapshot={snapshot} currentPlayerId={playerId} />
      )}

      {showProgress && (
        <nav className="tc-frame tc-strip" aria-label="Scores" data-testid="player-roster">
          {[...snapshot.players]
            .sort((a, b) => a.joinOrder - b.joinOrder)
            .map((player, index) => (
              <div
                key={player.id}
                className="tc-strip__team"
                data-active={(!player.leftAt && player.id === snapshot.activePlayerId) || undefined}
                data-faded={player.leftAt || player.presence === 'stale' ? true : undefined}
                data-testid={`player-row-${player.id}`}
              >
                <PixelAvatar name={player.nickname} index={index} />
                <span className="tc-strip__name">
                  {player.nickname}
                  {player.id === playerId && <span className="tc-player__note"> (you)</span>}
                </span>
                <span className="tc-strip__score">{player.score}</span>
              </div>
            ))}
        </nav>
      )}

      {showLeaveModal && (
        <PixelLeaveConfirmModal
          snapshot={snapshot}
          currentPlayerId={playerId}
          isPending={leave.isPending}
          onConfirm={onLeaveConfirm}
          onCancel={() => setShowLeaveModal(false)}
        />
      )}

      {handoffPlayer && (
        <PixelTurnHandoff nickname={handoffPlayer.nickname} onDismiss={onDismissHandoff} />
      )}
    </PixelScreen>
  );
}
