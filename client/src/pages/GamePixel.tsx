import { useSoloGame } from '@/hooks/use-solo-game';
import { PixelAvatar, PixelButton, PixelFrame, PixelScreen } from '@/components/pixel/Pixel';
import {
  PixelAnswerForm,
  PixelDialog,
  PixelDialogActions,
  PixelFactCard,
  PixelLoading,
  PixelProgress,
  PixelQuestionCard,
  PixelRevealCards,
  PixelRoundHeader,
  PixelStandings,
} from '@/components/pixel/Game';
import { PixelDisputeModal } from '@/components/pixel/PixelDisputeModal';

// Pixel-art solo game (STE-134, 135, 136, 157, 158), rendered by Game.tsx when
// VITE_PIXEL_UI is on. Behavior, copy and test ids match the classic game.
export default function GamePixel() {
  const {
    state,
    setTypedAnswer,
    submitAnswer,
    passQuestion,
    markDisputeSubmitted,
    advanceToScoreUpdate,
    continueToNextRound,
    disputeOpen,
    setDisputeOpen,
    showQuitConfirm,
    setShowQuitConfirm,
    isScoreUpdate,
    isReveal,
    currentQ,
    activeTeam,
    completedRounds,
    rankedTeams,
    winner,
    canDisputeAttempt,
    canAwardDisputedPoints,
    progressPercent,
    handleAwardDisputedPoints,
    confirmQuit,
    startNewGame,
  } = useSoloGame();

  // Exit sits in the top bar of every in-game screen and confirms first.
  const exitButton = (
    <PixelButton
      variant="stone"
      size="sm"
      onClick={() => setShowQuitConfirm(true)}
      aria-label="Exit game"
      data-testid="button-quit-game"
    >
      Exit
    </PixelButton>
  );
  const quitDialog = (
    <PixelDialog
      open={showQuitConfirm}
      onOpenChange={setShowQuitConfirm}
      title="End Game Early?"
      description="The game will end and final scores will be shown."
    >
      <PixelDialogActions>
        <PixelButton
          variant="stone"
          onClick={() => setShowQuitConfirm(false)}
          data-testid="button-cancel-quit"
        >
          Keep Playing
        </PixelButton>
        <PixelButton variant="red" onClick={confirmQuit} data-testid="button-confirm-quit">
          End Game
        </PixelButton>
      </PixelDialogActions>
    </PixelDialog>
  );

  if (state.phase === 'SETUP') {
    return (
      <PixelScreen>
        <PixelLoading label="Loading game..." testId="text-loading-game" />
      </PixelScreen>
    );
  }

  if (state.phase === 'QUESTION' && !state.questions.length) {
    return (
      <PixelScreen>
        <PixelLoading label="Loading questions..." testId="text-loading-questions" />
      </PixelScreen>
    );
  }

  const standings = rankedTeams.map((team) => ({
    id: team.id,
    name: team.name,
    score: team.score,
  }));

  if (state.phase === 'ROUND_SCORE' || isScoreUpdate) {
    const round =
      state.phase === 'ROUND_SCORE'
        ? Math.floor(state.currentQuestionIndex / (state.teams.length * 4))
        : completedRounds;
    return (
      <PixelScreen wide>
        <div className="tc-topbar">{exitButton}</div>
        <PixelRoundHeader label={`Round ${round} Complete`} />
        <PixelFrame title="Standings">
          <PixelStandings rows={standings} />
        </PixelFrame>
        <PixelButton variant="magenta" size="lg" block onClick={continueToNextRound}>
          {isScoreUpdate ? 'Start Next Round' : 'Next Round'}
        </PixelButton>
        {quitDialog}
      </PixelScreen>
    );
  }

  if (state.phase === 'GAME_OVER') {
    return (
      <PixelScreen>
        <header className="tc-stack" style={{ gap: 16, alignItems: 'center' }}>
          <p className="tc-pill">Completed</p>
          <h1 className="tc-game-over">Game Over</h1>
          {winner && (
            <p className="tc-tagline">
              Winner: <span className="tc-gold">{winner.name}</span>
            </p>
          )}
        </header>
        <PixelFrame title="Final Scores">
          <PixelStandings rows={standings} />
        </PixelFrame>
        <PixelButton variant="coin" size="lg" block onClick={startNewGame}>
          Start New Game
        </PixelButton>
      </PixelScreen>
    );
  }

  if (!currentQ) return null;

  const attempt = state.currentAttempt;

  return (
    <PixelScreen wide>
      <div className="tc-topbar">
        <PixelProgress value={progressPercent} />
        {exitButton}
      </div>

      <div className="tc-game-top">
        <p className="tc-chip">In Progress</p>
        {activeTeam && (
          <section className="tc-frame tc-turn" aria-label="Active team">
            <h2 className="tc-frame__title">Active Team</h2>
            <div className="tc-turn__body">
              <PixelAvatar
                name={activeTeam.name}
                index={state.teams.findIndex((t) => t.id === activeTeam.id)}
              />
              <div className="tc-stack" style={{ gap: 4 }}>
                <span className="tc-turn__name">{activeTeam.name}</span>
                <span className="tc-turn__count">
                  Question {(activeTeam.questionCount % 4) + 1}/4
                </span>
              </div>
            </div>
          </section>
        )}
      </div>

      <PixelQuestionCard
        key={currentQ.id}
        category={currentQ.category}
        difficulty={currentQ.difficulty}
        question={currentQ.question}
        size={isReveal ? 'md' : 'lg'}
      />

      {!isReveal && (
        <PixelAnswerForm
          value={state.typedAnswer}
          onChange={setTypedAnswer}
          onSubmit={() => state.typedAnswer.trim() && submitAnswer()}
          onPass={passQuestion}
        />
      )}

      {isReveal && attempt && (
        <>
          <PixelRevealCards
            answeredLabel="They Answered"
            submittedAnswer={attempt.submittedAnswer}
            verdict={attempt.verdict}
            pointsDelta={attempt.pointsDelta}
            correctAnswer={currentQ.answer}
          />
          <PixelFactCard
            explanation={currentQ.explanation}
            sourceUrl={currentQ.sourceUrl}
            sourceName={currentQ.sourceName}
          />
          <div className="tc-actions">
            <PixelButton variant="magenta" size="lg" onClick={advanceToScoreUpdate}>
              Next Question
            </PixelButton>
            {canAwardDisputedPoints && (
              <PixelButton variant="green" onClick={handleAwardDisputedPoints}>
                Group agreed — award points
              </PixelButton>
            )}
            {canDisputeAttempt && (
              <PixelButton variant="red" onClick={() => setDisputeOpen(true)}>
                Dispute
              </PixelButton>
            )}
          </div>
          <PixelDisputeModal
            open={disputeOpen}
            onOpenChange={setDisputeOpen}
            questionId={currentQ.id}
            questionText={currentQ.question}
            correctAnswer={currentQ.answer}
            teamName={activeTeam?.name || 'Unknown'}
            submittedAnswer={attempt.submittedAnswer || null}
            onDisputeSubmitted={markDisputeSubmitted}
          />
        </>
      )}

      <nav className="tc-frame tc-strip" aria-label="Scores">
        {state.teams.map((team, index) => (
          <div
            key={team.id}
            className="tc-strip__team"
            data-active={team.id === state.activeTeamId || undefined}
          >
            <PixelAvatar name={team.name} index={index} />
            <span className="tc-strip__name">{team.name}</span>
            <span className="tc-strip__score">{team.score}</span>
          </div>
        ))}
      </nav>

      {quitDialog}
    </PixelScreen>
  );
}
