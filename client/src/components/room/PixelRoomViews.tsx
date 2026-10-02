import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '@shared/models/rooms';

import { useQuestionView, type QuestionViewProps } from './QuestionView';
import { useRevealView, type RevealViewProps } from './RevealView';
import { useDisputeVoteView, type DisputeVoteViewProps } from './DisputeVoteView';
import { useRoundScore, type RoundScoreProps } from './RoundScore';
import { useFinalResults, type FinalResultsProps } from './FinalResults';
import { useRoomAbandoned, type RoomAbandonedProps } from './RoomAbandoned';
import { getDialogVariant, LEAVE_DIALOG_COPY } from './LeaveConfirmModal';
import { useThemedStart, type ThemedStartButtonProps } from './ThemedStartButton';
import { PixelBusy, PixelButton, PixelFrame, PixelScreen } from '@/components/pixel/Pixel';
import {
  PixelAnswerForm,
  PixelChip,
  PixelDialog,
  PixelDialogActions,
  PixelFactCard,
  PixelQuestionCard,
  PixelRevealCards,
  PixelRoundHeader,
  PixelStandings,
  formatDelta,
} from '@/components/pixel/Game';
import { PixelDisputeModal } from '@/components/pixel/PixelDisputeModal';

// Pixel versions of the multiplayer in-game views (STE-232, STE-233). Each
// reuses its classic view's hook, so behavior, copy and test ids match.

export function PixelQuestionView(props: QuestionViewProps) {
  const { snapshot, answer, skip } = props;
  const { value, setValue, isMyTurn, activePlayer, canSkip, handleSubmit, handlePass, handleSkip } =
    useQuestionView(props);

  return (
    <>
      {isMyTurn ? (
        <p className="tc-pill" style={{ alignSelf: 'center' }} data-testid="badge-your-turn">
          Your turn
        </p>
      ) : (
        <p className="tc-tagline" data-testid="text-waiting-turn">
          Waiting for {activePlayer?.nickname ?? 'player'} to answer…
        </p>
      )}

      {canSkip && (
        <PixelButton
          variant="stone"
          block
          onClick={handleSkip}
          disabled={skip.isPending}
          data-testid="button-skip-turn"
        >
          {skip.isPending ? 'Skipping…' : `Skip ${activePlayer?.nickname ?? 'their'} turn`}
        </PixelButton>
      )}

      <PixelQuestionCard
        key={snapshot.currentQuestion.id}
        category={snapshot.currentQuestion.category}
        difficulty={snapshot.currentQuestion.difficulty}
        question={snapshot.currentQuestion.question}
      />

      {isMyTurn && (
        <PixelAnswerForm
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          onPass={handlePass}
          disabled={answer.isPending}
          placeholder="Type your answer…"
          submitLabel={answer.isPending ? 'Submitting…' : 'Submit'}
          inputTestId="input-answer"
          submitTestId="button-submit-answer"
          passTestId="button-pass"
        />
      )}
    </>
  );
}

export function PixelRevealView(props: RevealViewProps) {
  const { snapshot, advance, awardDispute } = props;
  const {
    attempt,
    canAdvance,
    answeringPlayer,
    disputeOpen,
    setDisputeOpen,
    finalizedVote,
    canDispute,
    canAwardPoints,
    hasPendingManualDispute,
    handleNext,
    handleAwardDisputedPoints,
    handleSubmitDispute,
  } = useRevealView(props);
  const q = snapshot.currentQuestion;

  return (
    <>
      <PixelQuestionCard
        category={q.category}
        difficulty={q.difficulty}
        question={q.question}
        size="md"
        chips={
          <>
            {snapshot.theme && (
              <PixelChip tone="magenta" testId="badge-theme">
                {snapshot.theme}
              </PixelChip>
            )}
            {q.origin === 'player_ai' && (
              <PixelChip tone="magenta" testId="badge-ai-generated">
                AI-generated
              </PixelChip>
            )}
          </>
        }
      />

      {attempt && (
        <PixelRevealCards
          answeredLabel={`${answeringPlayer?.nickname ?? 'Player'} answered`}
          submittedAnswer={attempt.submittedAnswer}
          verdict={attempt.verdict}
          pointsDelta={attempt.pointsDelta}
          correctAnswer={q.answer}
          cardTestId="card-attempt-verdict"
          verdictTestId="text-verdict"
        />
      )}

      <PixelFactCard
        explanation={q.explanation}
        sourceUrl={q.sourceUrl}
        sourceName={q.sourceName}
      />

      {finalizedVote && (
        <div
          className={`tc-verdict ${finalizedVote.outcome === 'approved' ? 'tc-verdict--correct' : 'tc-verdict--pass'}`}
          aria-live="polite"
          data-testid="card-dispute-outcome"
        >
          <p className="tc-verdict__label">Dispute {finalizedVote.outcome}</p>
          <p className="tc-hint" style={{ color: '#fff' }}>
            Final score change: {formatDelta(finalizedVote.finalPointsDelta)}
          </p>
        </div>
      )}

      {hasPendingManualDispute && (
        <p className="tc-tagline" aria-live="polite" data-testid="text-dispute-submitted">
          Dispute submitted. The host can award points if the group agrees.
        </p>
      )}

      <div className="tc-actions">
        {canAdvance ? (
          <PixelButton
            variant="magenta"
            size="lg"
            onClick={handleNext}
            disabled={advance.isPending}
            data-testid="button-next"
          >
            {advance.isPending ? 'Continuing…' : 'Next'}
          </PixelButton>
        ) : (
          <p className="tc-tagline" data-testid="text-waiting-continue">
            Waiting to continue…
          </p>
        )}
        {canAwardPoints && (
          <PixelButton
            variant="green"
            onClick={handleAwardDisputedPoints}
            disabled={awardDispute.isPending}
          >
            {awardDispute.isPending ? 'Awarding…' : 'Group agreed — award points'}
          </PixelButton>
        )}
        {canDispute && (
          <PixelButton variant="red" onClick={() => setDisputeOpen(true)}>
            Dispute
          </PixelButton>
        )}
      </div>

      {attempt && (
        <PixelDisputeModal
          open={disputeOpen}
          onOpenChange={setDisputeOpen}
          questionId={q.id}
          questionText={q.question}
          correctAnswer={q.answer}
          teamName={answeringPlayer?.nickname || 'Unknown'}
          submittedAnswer={attempt.submittedAnswer}
          onDisputeSubmitted={() => undefined}
          submitDispute={handleSubmitDispute}
        />
      )}
    </>
  );
}

export function PixelDisputeVoteView(props: DisputeVoteViewProps) {
  const { snapshot, castDisputeVote, cancelDisputeVote } = props;
  const {
    vote,
    attempt,
    remaining,
    isHost,
    isDisputingPlayer,
    isEligible,
    hasVoted,
    canVote,
    submittedCount,
    eligibleCount,
    handleVote,
    handleCancel,
  } = useDisputeVoteView(props);

  return (
    <div className="tc-stack" style={{ gap: 24 }} data-testid="dispute-vote-view">
      <PixelQuestionCard
        category={snapshot.currentQuestion.category}
        difficulty={snapshot.currentQuestion.difficulty}
        question={snapshot.currentQuestion.question}
        size="md"
      />
      <PixelRevealCards
        answeredLabel={`${vote.disputingPlayerName} answered`}
        submittedAnswer={attempt?.submittedAnswer ?? null}
        correctLabel="Expected answer"
        correctAnswer={snapshot.currentQuestion.answer}
      />
      <PixelFrame title="Why It's Disputed">
        <p className="tc-hint">{vote.explanation}</p>
      </PixelFrame>
      <PixelFrame title="Opponent Vote">
        <div className="tc-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <p className="tc-hint" aria-live="polite" data-testid="text-vote-progress">
            {submittedCount} of {eligibleCount} votes submitted
          </p>
          <span
            className="tc-countdown"
            aria-label={`${remaining} seconds remaining`}
            data-testid="text-vote-countdown"
          >
            {remaining}s
          </span>
        </div>
        <div
          className="tc-progress"
          style={{ position: 'static' }}
          role="progressbar"
          aria-label="Votes submitted"
          aria-valuemin={0}
          aria-valuemax={eligibleCount}
          aria-valuenow={submittedCount}
        >
          <div
            className="tc-progress__fill"
            style={{ width: `${eligibleCount ? (submittedCount / eligibleCount) * 100 : 0}%` }}
          />
        </div>
        {isDisputingPlayer && (
          <p className="tc-hint" data-testid="text-disputant-waiting">
            Your dispute was submitted. Waiting for eligible opponents to vote…
          </p>
        )}
        {!isDisputingPlayer && hasVoted && (
          <p className="tc-hint" aria-live="polite" data-testid="text-vote-locked">
            Vote submitted. Your choice is locked.
          </p>
        )}
        {!isDisputingPlayer && !isEligible && (
          <p className="tc-hint" data-testid="text-observer-waiting">
            Waiting for eligible opponents to vote…
          </p>
        )}
        {canVote && (
          <div className="tc-dialog__actions">
            <PixelButton
              variant="green"
              onClick={() => handleVote(true)}
              disabled={castDisputeVote.isPending}
              aria-label="Agree and award points"
            >
              Agree
            </PixelButton>
            <PixelButton
              variant="red"
              onClick={() => handleVote(false)}
              disabled={castDisputeVote.isPending}
              aria-label="Disagree with dispute"
            >
              Disagree
            </PixelButton>
          </div>
        )}
        {isHost && (
          <PixelButton
            variant="stone"
            size="sm"
            onClick={handleCancel}
            disabled={cancelDisputeVote.isPending}
            aria-label="Cancel dispute vote"
          >
            {cancelDisputeVote.isPending ? 'Canceling…' : 'Cancel vote'}
          </PixelButton>
        )}
      </PixelFrame>
    </div>
  );
}

export function PixelRoundScore(props: RoundScoreProps) {
  const { currentPlayerId, continueRound } = props;
  const { isHost, ranked, handleNextRound } = useRoundScore(props);

  return (
    <>
      <PixelRoundHeader label="Round Complete" />
      <PixelFrame title="Standings">
        <PixelStandings
          rows={ranked.map((p) => ({
            id: p.id,
            name: p.nickname,
            score: p.score,
            delta: p.lastRoundDelta,
            note: p.id === currentPlayerId ? '(you)' : undefined,
          }))}
          rowTestId={(id) => `round-score-row-${id}`}
          deltaTestId={(id) => `round-score-delta-${id}`}
        />
      </PixelFrame>
      {isHost ? (
        <PixelButton
          variant="magenta"
          size="lg"
          block
          onClick={handleNextRound}
          disabled={continueRound.isPending}
          data-testid="button-next-round"
        >
          {continueRound.isPending ? 'Starting…' : 'Next Round'}
        </PixelButton>
      ) : (
        <p className="tc-tagline" data-testid="text-waiting-host-round">
          Waiting for host…
        </p>
      )}
    </>
  );
}

export function PixelFinalResults(props: FinalResultsProps) {
  const { currentPlayerId } = props;
  const { ranked, winners, isTie, handleBackToHome } = useFinalResults(props);

  return (
    <>
      <header className="tc-stack" style={{ gap: 16, alignItems: 'center' }}>
        <p className="tc-pill">Game Over</p>
        <h1 className="tc-game-over">Final Results</h1>
        {isTie ? (
          <p className="tc-tagline" data-testid="text-winner">
            It&rsquo;s a tie:{' '}
            <span className="tc-gold">{winners.map((w) => w.nickname).join(' & ')}</span>
          </p>
        ) : (
          ranked[0] && (
            <p className="tc-tagline" data-testid="text-winner">
              Winner: <span className="tc-gold">{ranked[0].nickname}</span>
            </p>
          )
        )}
      </header>
      <PixelFrame title="Final Scores">
        <PixelStandings
          rows={ranked.map((p) => ({
            id: p.id,
            name: p.nickname,
            score: p.score,
            faded: !!p.leftAt,
            note:
              [p.id === currentPlayerId ? '(you)' : '', p.leftAt ? '(left)' : '']
                .filter(Boolean)
                .join(' ') || undefined,
          }))}
          rowTestId={(id) => `final-result-row-${id}`}
        />
      </PixelFrame>
      <PixelButton
        variant="coin"
        size="lg"
        block
        onClick={handleBackToHome}
        data-testid="button-back-home"
      >
        Back to Home
      </PixelButton>
    </>
  );
}

export function PixelRoomAbandoned(props: RoomAbandonedProps) {
  const { ranked, homeButtonRef, handleBackToHome } = useRoomAbandoned(props);
  return (
    <PixelScreen>
      <section
        className="tc-stack"
        style={{ gap: 24 }}
        data-testid="room-abandoned"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-abandoned-title"
      >
        <h1 id="room-abandoned-title" className="tc-game-over">
          Room Closed
        </h1>
        <p className="tc-tagline">The host has ended this game.</p>
        {ranked.length > 0 && (
          <PixelFrame title="Final Scores">
            <PixelStandings
              rows={ranked.map((p) => ({ id: p.id, name: p.nickname, score: p.score }))}
              rowTestId={(id) => `abandoned-result-row-${id}`}
            />
          </PixelFrame>
        )}
        <PixelButton
          ref={homeButtonRef}
          variant="coin"
          size="lg"
          block
          onClick={handleBackToHome}
          data-testid="button-abandoned-home"
        >
          Back to Home
        </PixelButton>
      </section>
    </PixelScreen>
  );
}

export function PixelLeaveConfirmModal({
  snapshot,
  currentPlayerId,
  isPending,
  onConfirm,
  onCancel,
}: {
  snapshot: RoomSnapshot;
  currentPlayerId: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const variant = getDialogVariant(snapshot, currentPlayerId);
  const copy = LEAVE_DIALOG_COPY[variant];
  return (
    <PixelDialog
      open
      onOpenChange={(open) => !open && !isPending && onCancel()}
      title={copy.title}
      description={copy.body}
      testId="leave-confirm-modal"
    >
      {variant === 'ends-game' && (
        <PixelStandings
          rows={[...snapshot.players]
            .filter((p) => !p.leftAt)
            .sort((a, b) => b.score - a.score)
            .map((p) => ({
              id: p.id,
              name: p.nickname,
              score: p.score,
              note: p.id === currentPlayerId ? '(you)' : undefined,
            }))}
        />
      )}
      <PixelDialogActions>
        <PixelButton
          variant="stone"
          onClick={onCancel}
          disabled={isPending}
          data-testid="button-leave-cancel"
        >
          {copy.cancel}
        </PixelButton>
        <PixelButton
          variant="red"
          onClick={onConfirm}
          disabled={isPending}
          data-testid="button-leave-confirm"
        >
          {isPending ? (
            <>
              <PixelBusy />
              Leaving…
            </>
          ) : (
            copy.confirm
          )}
        </PixelButton>
      </PixelDialogActions>
    </PixelDialog>
  );
}

const HANDOFF_DISMISS_MS = 2000;

export function PixelTurnHandoff({
  nickname,
  onDismiss,
}: {
  nickname: string;
  onDismiss: () => void;
}) {
  const savedDismiss = useRef(onDismiss);
  savedDismiss.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => savedDismiss.current(), HANDOFF_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="tc-handoff" data-testid="turn-handoff">
      <div className="tc-frame tc-handoff__card" role="status">
        It&rsquo;s {nickname}&rsquo;s turn!
      </div>
    </div>
  );
}

// Pixel themed-game start with generation progress (STE-233).
export function PixelThemedStart(props: ThemedStartButtonProps) {
  const { theme, canStart } = props;
  const { progress, preparing, isBusy, startGame, retry } = useThemedStart(props);
  return (
    <div className="tc-stack">
      <PixelButton
        variant="red"
        size="lg"
        block
        disabled={!canStart || isBusy}
        onClick={() => canStart && !isBusy && startGame()}
        data-testid="button-start-themed-game"
      >
        {isBusy ? (
          <>
            <PixelBusy />
            Generating…
          </>
        ) : (
          'Start Themed Game'
        )}
      </PixelButton>
      {preparing && progress && progress.status !== 'error' && (
        <div className="tc-parchment" aria-live="polite" data-testid="text-theme-progress">
          <p>
            Generating &ldquo;{theme}&rdquo; game… {progress.ready} of {progress.total} ready
          </p>
          <p className="tc-hint" style={{ color: 'inherit' }}>
            {progress.reused} reused · {progress.generated} newly written
          </p>
        </div>
      )}
      {progress?.status === 'error' && (
        <div className="tc-parchment" aria-live="polite" data-testid="text-theme-error">
          <p>{progress.error ?? 'Themed preparation failed.'}</p>
          <PixelButton variant="stone" size="sm" onClick={retry}>
            Try again
          </PixelButton>
        </div>
      )}
      {!canStart && (
        <p className="tc-tagline" data-testid="text-need-players">
          Need at least 2 players
        </p>
      )}
    </div>
  );
}
