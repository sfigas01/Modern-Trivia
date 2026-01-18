import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGame, Team } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, Minus, ArrowRight, Trophy, Flag, ExternalLink, LogOut } from "lucide-react";
import { DisputeModal } from "@/components/DisputeModal";

const QUESTIONS_PER_TEAM_ROTATION = 4;

export default function Game() {
  const [_, setLocation] = useLocation();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const {
    state,
    setTypedAnswer,
    submitAnswer,
    passQuestion,
    advanceToScoreUpdate,
    continueToNextRound,
    endGame,
    resetGame
  } = useGame();

  // Redirect if invalid state
  useEffect(() => {
    if (state.phase === "SETUP" || state.teams.length === 0) {
      setLocation("/");
    }
  }, [state.phase, state.teams.length, setLocation]);

  if (state.phase === "ROUND_SCORE") {
    const sortedTeams = [...state.teams].sort((a, b) => b.score - a.score);
    const currentRound = Math.floor(state.currentQuestionIndex / (state.teams.length * 4));
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-6 max-w-2xl w-full"
        >
          <div className="space-y-2">
            <Badge variant="outline" className="border-primary/40 text-primary flex items-center justify-center gap-2 mx-auto">
              <Trophy className="w-4 h-4" />
              Round {currentRound} Complete
            </Badge>
            <h1 className="text-5xl font-bold">Round Scores</h1>
          </div>
          <Card className="border-white/10 bg-white/5 backdrop-blur-md">
            <CardContent className="p-6 space-y-3">
              {sortedTeams.map((team, index) => (
                <motion.div
                  key={team.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-primary">#{index + 1}</span>
                    <span className="font-semibold">{team.name}</span>
                  </div>
                  <span className="font-mono text-xl font-bold">{team.score}</span>
                </motion.div>
              ))}
            </CardContent>
          </Card>
          <Button
            onClick={continueToNextRound}
            className="w-full h-14 text-lg font-bold"
          >
            NEXT ROUND <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </motion.div>
      </div>
    );
  }

  if (state.phase === "GAME_OVER" || !state.questions.length) {
    // Could render a nice game over screen here
    const rankedTeams = [...state.teams].sort((a, b) => b.score - a.score);
    const winner = rankedTeams[0];
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-6 max-w-2xl w-full px-4">
          <div className="space-y-2">
            <Badge variant="outline" className="border-primary/40 text-primary">
              Completed
            </Badge>
            <h1 className="text-4xl font-bold">Game Over</h1>
            {winner && (
              <p className="text-muted-foreground">
                Winner: <span className="text-primary font-semibold">{winner.name}</span>
              </p>
            )}
          </div>
          <Card className="border-white/10 bg-white/5 backdrop-blur-md">
            <CardContent className="p-6 space-y-3">
              {rankedTeams.map((team, index) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">#{index + 1}</span>
                    <span className="font-semibold">{team.name}</span>
                  </div>
                  <span className="font-mono text-lg">{team.score}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="flex justify-center">
            <Button
              onClick={() => {
                resetGame();
                setLocation("/");
              }}
            >
              Start New Game
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const isScoreUpdate = state.phase === "SCORE_UPDATE";
  const currentQ = isScoreUpdate ? null : state.questions[state.currentQuestionIndex];
  // If we are in REVEAL state, we might be 'between' indices effectively if we handled it differently,
  // but here index increments AFTER reveal. So currentQ is still the one we just answered.
  // Wait, advanceToScoreUpdate increments index. So in REVEAL, index is correct.

  // Actually, if we are in REVEAL, currentQ should be valid.
  // If we are in GAME_OVER, we returned early.

  if (!isScoreUpdate && !currentQ) return null;

  const activeTeam = state.teams.find(t => t.id === state.activeTeamId);
  const isReveal = state.phase === "REVEAL";
  const statusLabel = "In Progress";
  const questionsPerRound = state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
  const completedRounds = questionsPerRound > 0 ? Math.floor(state.currentQuestionIndex / questionsPerRound) : 0;
  const rankedTeams = [...state.teams].sort((a, b) => b.score - a.score);

  const getDifficultyColor = (d: string) => {
    switch (d) {
      case "Easy": return "bg-[var(--color-difficulty-easy)] text-white";
      case "Medium": return "bg-[var(--color-difficulty-medium)] text-black";
      case "Hard": return "bg-[var(--color-difficulty-hard)] text-white";
      default: return "bg-primary";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isReveal && state.typedAnswer.trim()) {
      submitAnswer();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Top Bar - Progress */}
      <div className="w-full h-2 bg-white/5">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: "0%" }}
          animate={{ width: `${((state.currentQuestionIndex) / state.questions.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 max-w-6xl mx-auto w-full relative z-10">

        {/* Question Area */}
        <AnimatePresence mode="wait">
          {isScoreUpdate ? (
            <motion.div
              key="score-update"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-4xl space-y-6 text-center"
            >
              <div className="space-y-2">
                <Badge variant="outline" className="border-primary/40 text-primary">
                  Round {completedRounds} Complete
                </Badge>
                <h1 className="text-3xl md:text-4xl font-bold">Score Update</h1>
                <p className="text-muted-foreground">Here are the standings after this round.</p>
              </div>
              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardContent className="p-6 space-y-3">
                  {rankedTeams.map((team, index) => (
                    <div
                      key={team.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">#{index + 1}</span>
                        <span className="font-semibold">{team.name}</span>
                      </div>
                      <span className="font-mono text-lg">{team.score}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Button
                onClick={continueToNextRound}
                className="w-full h-16 text-xl font-bold shadow-lg mt-4"
              >
                START NEXT ROUND <ArrowRight className="ml-2 w-6 h-6" />
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key={currentQ?.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-4xl space-y-6"
            >
              {/* Metadata */}
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-lg px-4 py-2 border-white/20 bg-white/5">
                    {currentQ?.category}
                  </Badge>
                  <Badge className={`text-lg px-4 py-2 ${currentQ ? getDifficultyColor(currentQ.difficulty) : "bg-primary"} border-none shadow-lg`}>
                    {currentQ?.difficulty}
                  </Badge>
                  <Badge variant="outline" className="text-lg px-4 py-2 border-primary/40 text-primary">
                    {statusLabel}
                  </Badge>
                </div>
                {activeTeam && (
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground uppercase tracking-widest">Active Team</div>
                    <div className="text-xl font-bold text-primary">{activeTeam.name}</div>
                    <div className="text-xs text-muted-foreground">Question {activeTeam.questionCount % 4 + 1}/4</div>
                  </div>
                )}
              </div>

              {/* The Question */}
              <div className="min-h-[200px] flex items-center justify-center text-center p-8 md:p-12 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl">
                <h1 className="text-3xl md:text-5xl font-bold leading-tight font-display tracking-tight">
                  {currentQ?.question}
                </h1>
              </div>

              {/* REVEAL STATE UI */}
              {isReveal && state.currentAttempt && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card className={`border-2 ${state.currentAttempt.verdict === 'CORRECT' ? 'border-green-500/50 bg-green-500/10' :
                      state.currentAttempt.verdict === 'PASS' ? 'border-yellow-500/50 bg-yellow-500/10' :
                        'border-red-500/50 bg-red-500/10'
                      }`}>
                      <CardContent className="p-4 text-center">
                        <div className="text-sm uppercase tracking-widest opacity-70 mb-1">They Answered</div>
                        <div className="text-2xl font-bold">
                          {state.currentAttempt.submittedAnswer || "(Passed)"}
                        </div>
                        <div className="mt-2 font-mono font-bold text-lg">
                          {state.currentAttempt.verdict} ({state.currentAttempt.pointsDelta > 0 ? '+' : ''}{state.currentAttempt.pointsDelta})
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-primary/10 border-primary/20">
                      <CardContent className="p-4 text-center">
                        <div className="text-sm uppercase tracking-widest opacity-70 mb-1">Correct Answer</div>
                        <div className="text-2xl font-bold text-primary">
                          {currentQ?.answer}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg text-center text-muted-foreground italic">
                    {currentQ?.explanation}
                  </div>

                  {currentQ?.sourceUrl && (
                    <div className="flex justify-center">
                      <a
                        href={currentQ.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {currentQ.sourceName || "Verify Source"}
                      </a>
                    </div>
                  )}

                  <div className="flex gap-4 mt-4">
                    <Button
                      onClick={advanceToScoreUpdate}
                      className="flex-1 h-16 text-xl font-bold shadow-lg"
                    >
                      NEXT QUESTION <ArrowRight className="ml-2 w-6 h-6" />
                    </Button>
                    <Button
                      onClick={() => setDisputeOpen(true)}
                      variant="outline"
                      className="h-16 px-6 border-white/20 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    >
                      <Flag className="w-5 h-5" />
                      <span className="hidden sm:inline ml-2">Dispute</span>
                    </Button>
                  </div>

                  <DisputeModal
                    open={disputeOpen}
                    onOpenChange={setDisputeOpen}
                    questionId={currentQ?.id || ""}
                    questionText={currentQ?.question || ""}
                    correctAnswer={currentQ?.answer || ""}
                    teamName={activeTeam?.name || "Unknown"}
                    submittedAnswer={state.currentAttempt?.submittedAnswer || null}
                  />
                </motion.div>
              )}

              {/* QUESTION STATE UI */}
          {!isReveal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4 max-w-2xl mx-auto pt-4"
            >
              <Input
                value={state.typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                placeholder="Type answer here..."
                className="h-20 text-2xl text-center bg-white/5 border-white/10 focus:border-primary/50"
                autoFocus
                onKeyDown={handleKeyDown}
              />
              <div className="grid grid-cols-3 gap-4">
                <Button
                  variant="secondary"
                  onClick={passQuestion}
                  className="h-14 text-lg"
                >
                  Pass
                </Button>
                <Button
                  onClick={submitAnswer}
                  disabled={!state.typedAnswer.trim()}
                  className="col-span-2 h-14 text-lg font-bold"
                >
                  Submit Answer
                </Button>
              </div>
            </motion.div>
          )}

        </motion.div>
           )}
      </AnimatePresence>
    </div>

      {/* Scoreboard Preview (Bottom) */}
      <div className="w-full bg-white/5 border-t border-white/10 p-4 z-20 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center gap-4 overflow-x-auto pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowQuitConfirm(true)}
            className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
            data-testid="button-quit-game"
          >
            <LogOut className="w-4 h-4 mr-1" />
            Quit
          </Button>
          {state.teams.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border ${t.id === state.activeTeamId ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-white/10'}`}
            >
              <span className="font-bold">{t.name}</span>
              <span className="font-mono bg-black/20 px-2 rounded">{t.score}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quit Confirmation Modal */}
      <AnimatePresence>
        {showQuitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-background border border-white/10 rounded-xl p-6 max-w-md w-full space-y-4"
            >
              <div className="text-center space-y-2">
                <LogOut className="w-12 h-12 mx-auto text-red-500" />
                <h2 className="text-2xl font-bold">End Game Early?</h2>
                <p className="text-muted-foreground">
                  The game will end and final scores will be shown.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowQuitConfirm(false)}
                  data-testid="button-cancel-quit"
                >
                  Keep Playing
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setShowQuitConfirm(false);
                    endGame();
                  }}
                  data-testid="button-confirm-quit"
                >
                  End Game
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background decoration */}
      <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-background to-transparent z-0 pointer-events-none" />
    </div>
  );
}
