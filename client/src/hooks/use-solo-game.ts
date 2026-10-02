import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useGame } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';

const QUESTIONS_PER_TEAM_ROTATION = 4;

// Screen state and handlers for the solo game, shared by the classic and pixel
// (VITE_PIXEL_UI) layouts. Game rules stay in the store.
export function useSoloGame() {
  const [, setLocation] = useLocation();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const { toast } = useToast();
  const game = useGame();
  const { state, awardDisputedPoints, submitAnswer, endGame, resetGame } = game;

  // Redirect if invalid state — only when explicitly in SETUP with no teams
  useEffect(() => {
    if (state.phase === 'SETUP' && state.teams.length === 0) {
      setLocation('/');
    }
  }, [state.phase, state.teams.length, setLocation]);

  const isScoreUpdate = state.phase === 'SCORE_UPDATE';
  const isReveal = state.phase === 'REVEAL';
  const currentQ = isScoreUpdate ? null : state.questions[state.currentQuestionIndex];
  const activeTeam = state.teams.find((t) => t.id === state.activeTeamId);
  const questionsPerRound = state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
  const completedRounds =
    questionsPerRound > 0 ? Math.floor(state.currentQuestionIndex / questionsPerRound) : 0;
  const rankedTeams = [...state.teams].sort((a, b) => b.score - a.score);
  const canDisputeAttempt =
    isReveal &&
    state.currentAttempt?.verdict === 'INCORRECT' &&
    state.currentAttempt.pointsAwarded !== true;
  const canAwardDisputedPoints =
    canDisputeAttempt &&
    state.currentAttempt?.disputeSubmitted === true &&
    state.currentAttempt.pointsAwarded !== true;
  const progressPercent = state.questions.length
    ? (state.currentQuestionIndex / state.questions.length) * 100
    : 0;

  const handleAwardDisputedPoints = () => {
    awardDisputedPoints();
    toast({
      title: 'Points Awarded',
      description: `Points awarded to ${activeTeam?.name || 'team'}.`,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isReveal && state.typedAnswer.trim()) {
      submitAnswer();
    }
  };

  return {
    ...game,
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
    winner: rankedTeams[0],
    canDisputeAttempt,
    canAwardDisputedPoints,
    progressPercent,
    handleAwardDisputedPoints,
    handleKeyDown,
    confirmQuit: () => {
      setShowQuitConfirm(false);
      endGame();
    },
    startNewGame: () => {
      resetGame();
      setLocation('/');
    },
  };
}
