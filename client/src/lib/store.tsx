import React, { createContext, useContext, useState, useEffect } from 'react';
import { verifyAttempt, pointsFor, QUESTIONS_PER_TEAM_ROTATION } from '@shared/lib/answers';
import type { Question } from '@shared/lib/answers';
export type { Difficulty, Question } from '@shared/lib/answers';
export {
  normalize,
  verifyAttempt,
  pointsFor,
  QUESTIONS_PER_TEAM_ROTATION,
} from '@shared/lib/answers';

export type Phase =
  | 'SETUP'
  | 'QUESTION'
  | 'VERIFYING'
  | 'REVEAL'
  | 'SCORE_UPDATE'
  | 'ROUND_SCORE'
  | 'GAME_OVER';
export type Verdict = 'CORRECT' | 'INCORRECT' | 'PASS' | 'PENDING';

export interface Team {
  id: string;
  name: string;
  score: number;
  questionCount: number;
  lastRoundDelta: number;
}

export interface Attempt {
  questionId: string;
  teamId: string;
  submittedAnswer: string | null;
  verdict: Verdict;
  pointsDelta: number;
  processed: boolean;
  disputeSubmitted?: boolean;
  pointsAwarded?: boolean;
}

export interface GameState {
  teams: Team[];
  questions: Question[];
  categories: string[];
  selectedCategory: string;
  currentQuestionIndex: number;
  phase: Phase;
  activeTeamId: string | null;
  typedAnswer: string;
  currentAttempt: Attempt | null;
  numRounds: number;
}

interface GameContextType {
  state: GameState;
  addTeam: (name: string) => void;
  removeTeam: (id: string) => void;
  setCategory: (category: string) => void;
  setNumRounds: (rounds: number) => void;
  startGame: () => Promise<void>;
  setTypedAnswer: (text: string) => void;
  submitAnswer: () => void;
  passQuestion: () => void;
  markDisputeSubmitted: () => void;
  awardDisputedPoints: () => void;
  advanceToScoreUpdate: () => void;
  continueToNextRound: () => void;
  endGame: () => void;
  resetGame: () => void;
  addQuestion: (q: Question) => Promise<void>;
  updateQuestion: (q: Question) => Promise<void>;
  deleteQuestion: (id: string) => Promise<void>;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>({
    teams: [],
    questions: [],
    categories: [],
    selectedCategory: 'All',
    currentQuestionIndex: 0,
    phase: 'SETUP',
    activeTeamId: null,
    typedAnswer: '',
    currentAttempt: null,
    numRounds: 10,
  });

  // Load questions from the database API whenever we enter SETUP phase
  // (initial mount AND after resetGame() brings us back to SETUP)
  useEffect(() => {
    if (state.phase !== 'SETUP') return;
    async function loadQuestions() {
      try {
        const res = await fetch('/api/questions', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load questions');
        const data = await res.json();
        setState((s) => {
          if (s.phase !== 'SETUP') return s;
          return {
            ...s,
            questions: data.questions,
            categories: ['All', ...data.categories],
          };
        });
      } catch (error) {
        console.error('Failed to load questions from API:', error);
      }
    }
    loadQuestions();
  }, [state.phase]);

  // Record only actually-presented questions as seen when game ends
  useEffect(() => {
    if (state.phase === 'GAME_OVER' && state.questions.length > 0) {
      // currentQuestionIndex points past the last asked question, so slice(0, index)
      // captures exactly the questions that were presented to players
      const askedQuestions = state.questions.slice(0, state.currentQuestionIndex);
      if (askedQuestions.length === 0) return;
      const seenIds = askedQuestions.map((q) => q.id);
      fetch('/api/questions/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionIds: seenIds }),
      }).catch((err) => console.error('Failed to record seen questions:', err));
    }
  }, [state.phase]);

  const addTeam = (name: string) => {
    setState((prev) => ({
      ...prev,
      teams: [
        ...prev.teams,
        { id: crypto.randomUUID(), name, score: 0, questionCount: 0, lastRoundDelta: 0 },
      ],
    }));
  };

  const removeTeam = (id: string) => {
    setState((prev) => ({
      ...prev,
      teams: prev.teams.filter((t) => t.id !== id),
    }));
  };

  const setCategory = (category: string) => setState((s) => ({ ...s, selectedCategory: category }));
  const setNumRounds = (rounds: number) => setState((s) => ({ ...s, numRounds: rounds }));

  const startGame = async () => {
    const totalNeeded = state.numRounds * state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
    const categoryParam =
      state.selectedCategory !== 'All'
        ? `&category=${encodeURIComponent(state.selectedCategory)}`
        : '';

    try {
      const res = await fetch(
        `/api/questions?shuffle=true&limit=${totalNeeded}&excludeSeen=true${categoryParam}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch game questions');
      const data = await res.json();

      setState((prev) => ({
        ...prev,
        questions: data.questions,
        phase: 'QUESTION',
        activeTeamId: prev.teams[0].id,
        currentQuestionIndex: 0,
      }));
    } catch (error) {
      console.error('Failed to fetch questions from API, falling back to client-side:', error);
      // Fallback to client-side shuffle of already-loaded questions
      setState((prev) => {
        let filtered =
          prev.selectedCategory === 'All'
            ? [...prev.questions]
            : prev.questions.filter((q) => q.category === prev.selectedCategory);
        filtered = filtered.sort(() => Math.random() - 0.5);
        const finalQuestions = filtered.slice(0, totalNeeded);
        return {
          ...prev,
          questions: finalQuestions,
          phase: 'QUESTION',
          activeTeamId: prev.teams[0].id,
          currentQuestionIndex: 0,
        };
      });
    }
  };

  const setTypedAnswer = (text: string) => setState((s) => ({ ...s, typedAnswer: text }));

  const submitAnswer = () => {
    setState((prev) => {
      if (prev.phase !== 'QUESTION' || !prev.activeTeamId) return prev;

      const currentQ = prev.questions[prev.currentQuestionIndex];
      const { verdict, points } = verifyAttempt(prev.typedAnswer, currentQ);

      const attempt: Attempt = {
        questionId: currentQ.id,
        teamId: prev.activeTeamId,
        submittedAnswer: prev.typedAnswer,
        verdict,
        pointsDelta: points,
        processed: false,
      };

      return {
        ...prev,
        phase: 'REVEAL',
        currentAttempt: attempt,
      };
    });
  };

  const passQuestion = () => {
    setState((prev) => {
      if (prev.phase !== 'QUESTION' || !prev.activeTeamId) return prev;

      const currentQ = prev.questions[prev.currentQuestionIndex];

      const attempt: Attempt = {
        questionId: currentQ.id,
        teamId: prev.activeTeamId,
        submittedAnswer: null,
        verdict: 'PASS',
        pointsDelta: 0,
        processed: false,
      };

      return {
        ...prev,
        phase: 'REVEAL',
        currentAttempt: attempt,
        typedAnswer: '',
      };
    });
  };

  const markDisputeSubmitted = () => {
    setState((prev) => {
      if (prev.phase !== 'REVEAL' || !prev.currentAttempt) return prev;

      return {
        ...prev,
        currentAttempt: {
          ...prev.currentAttempt,
          disputeSubmitted: true,
        },
      };
    });
  };

  const awardDisputedPoints = () => {
    setState((prev) => {
      const attempt = prev.currentAttempt;
      const currentQ = prev.questions[prev.currentQuestionIndex];

      if (
        prev.phase !== 'REVEAL' ||
        !attempt ||
        !currentQ ||
        attempt.verdict !== 'INCORRECT' ||
        attempt.disputeSubmitted !== true ||
        attempt.pointsAwarded === true
      ) {
        return prev;
      }

      const correctPoints = pointsFor(currentQ.difficulty);
      const scoreAdjustment = attempt.processed
        ? correctPoints - attempt.pointsDelta
        : correctPoints;

      return {
        ...prev,
        teams: prev.teams.map((team) => {
          if (team.id !== attempt.teamId) return team;

          return {
            ...team,
            score: team.score + scoreAdjustment,
            lastRoundDelta: correctPoints,
          };
        }),
        currentAttempt: {
          ...attempt,
          verdict: 'CORRECT',
          pointsDelta: correctPoints,
          processed: true,
          pointsAwarded: true,
        },
      };
    });
  };

  const advanceToScoreUpdate = () => {
    setState((prev) => {
      if (prev.phase !== 'REVEAL' || !prev.currentAttempt) return prev;

      const attempt = prev.currentAttempt;
      const shouldApplyScore = !attempt.processed;
      const updatedTeams = prev.teams.map((t) => {
        if (t.id === attempt.teamId) {
          return {
            ...t,
            score: shouldApplyScore ? t.score + attempt.pointsDelta : t.score,
            questionCount: t.questionCount + 1,
            lastRoundDelta: attempt.pointsDelta,
          };
        }
        return { ...t, lastRoundDelta: 0 };
      });

      const processedAttempt = { ...attempt, processed: true };

      const activeTeam = updatedTeams.find((t) => t.id === prev.activeTeamId);
      let nextActiveTeamId = prev.activeTeamId;

      if (activeTeam && activeTeam.questionCount % QUESTIONS_PER_TEAM_ROTATION === 0) {
        const currentTeamIndex = updatedTeams.findIndex((t) => t.id === prev.activeTeamId);
        const nextTeamIndex = (currentTeamIndex + 1) % updatedTeams.length;
        nextActiveTeamId = updatedTeams[nextTeamIndex].id;
      }

      const nextIndex = prev.currentQuestionIndex + 1;
      let nextPhase: Phase = 'QUESTION';

      const questionsPerRound = prev.teams.length * QUESTIONS_PER_TEAM_ROTATION;
      const isRoundComplete = nextIndex % questionsPerRound === 0;

      if (nextIndex >= prev.questions.length) {
        nextPhase = 'GAME_OVER';
      } else if (isRoundComplete) {
        nextPhase = 'ROUND_SCORE';
      }

      return {
        ...prev,
        teams: updatedTeams,
        currentAttempt: processedAttempt,
        currentQuestionIndex: nextIndex,
        activeTeamId: nextActiveTeamId,
        phase: nextPhase,
        typedAnswer: '',
      };
    });
  };

  const continueToNextRound = () => {
    setState((prev) => ({
      ...prev,
      phase: 'QUESTION',
    }));
  };

  const endGame = () => {
    setState((prev) => ({ ...prev, phase: 'GAME_OVER' }));
  };

  const resetGame = () => {
    setState((prev) => ({
      ...prev,
      phase: 'SETUP',
      teams: [],
      questions: [],
      selectedCategory: 'All',
      currentQuestionIndex: 0,
      activeTeamId: null,
      typedAnswer: '',
      currentAttempt: null,
      numRounds: 10,
    }));
  };

  const addQuestion = async (q: Question) => {
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(q),
      });
      if (!res.ok) throw new Error('Failed to create question');
      const created = await res.json();
      setState((prev) => ({
        ...prev,
        questions: [created, ...prev.questions],
      }));
    } catch (error) {
      console.error('Failed to add question:', error);
      throw error;
    }
  };

  const updateQuestion = async (updatedQ: Question) => {
    try {
      const opts = {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' as const,
        body: JSON.stringify(updatedQ),
      };
      let res = await fetch(`/api/questions/${updatedQ.id}`, opts);

      if (res.status === 401) {
        await fetch('/api/auth/user', { credentials: 'include' });
        res = await fetch(`/api/questions/${updatedQ.id}`, opts);
      }

      if (res.status === 401) {
        throw new Error('Session expired — please reload the page and sign in again.');
      }
      if (!res.ok) throw new Error('Failed to update question');
      const updated = await res.json();
      setState((prev) => ({
        ...prev,
        questions: prev.questions.map((q) => (q.id === updated.id ? updated : q)),
      }));
    } catch (error) {
      console.error('Failed to update question:', error);
      throw error;
    }
  };

  const deleteQuestion = async (id: string) => {
    try {
      let res = await fetch(`/api/questions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.status === 401) {
        await fetch('/api/auth/user', { credentials: 'include' });
        res = await fetch(`/api/questions/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }

      if (res.status === 401) {
        throw new Error('Session expired — please reload the page and sign in again.');
      }
      if (!res.ok) throw new Error('Failed to delete question');
      setState((prev) => ({
        ...prev,
        questions: prev.questions.filter((q) => q.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete question:', error);
      throw error;
    }
  };

  return (
    <GameContext.Provider
      value={{
        state,
        addTeam,
        removeTeam,
        setCategory,
        setNumRounds,
        startGame,
        setTypedAnswer,
        submitAnswer,
        passQuestion,
        markDisputeSubmitted,
        awardDisputedPoints,
        advanceToScoreUpdate,
        continueToNextRound,
        endGame,
        resetGame,
        addQuestion,
        updateQuestion,
        deleteQuestion,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
