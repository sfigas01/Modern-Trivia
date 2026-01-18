import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import initialQuestions from "./questions.json";
// @ts-ignore
import stringSimilarity from "string-similarity";

export type Difficulty = "Easy" | "Medium" | "Hard";
export type Phase = "SETUP" | "QUESTION" | "VERIFYING" | "REVEAL" | "SCORE_UPDATE" | "ROUND_SCORE" | "GAME_OVER";
export type Verdict = "CORRECT" | "INCORRECT" | "PASS" | "PENDING";

export interface Question {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  answer: string;
  acceptableAnswers?: string[];
  explanation: string;
  tags: string[];
  sourceUrl?: string;
  sourceName?: string;
}

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
  startGame: () => void;
  setTypedAnswer: (text: string) => void;
  submitAnswer: () => void;
  passQuestion: () => void;
  advanceToScoreUpdate: () => void;
  continueToNextRound: () => void;
  endGame: () => void;
  resetGame: () => void;
  addQuestion: (q: Question) => void;
  updateQuestion: (q: Question) => void;
}

// ... (omitting context creation lines if not changing)

// In implementation:

const GameContext = createContext<GameContextType | undefined>(undefined);

const STORAGE_KEY_QUESTIONS = "modern_trivia_questions";
const STORAGE_KEY_VERSION = "modern_trivia_questions_version";
const QUESTIONS_VERSION = 2; // Bump this when questions.json is updated with new fields
const QUESTIONS_PER_TEAM_ROTATION = 4;

const normalize = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[.,!?'"]/g, "") // Remove punctuation
    .replace(/\b(a|an|the)\b/g, "") // Remove articles (simple regex)
    .replace(/\b(zero|0)\b/g, "0")
    .replace(/\b(one|1)\b/g, "1")
    .replace(/\b(two|2)\b/g, "2")
    .replace(/\b(three|3)\b/g, "3")
    .replace(/\b(four|4)\b/g, "4")
    .replace(/\b(five|5)\b/g, "5")
    .replace(/\b(six|6)\b/g, "6")
    .replace(/\b(seven|7)\b/g, "7")
    .replace(/\b(eight|8)\b/g, "8")
    .replace(/\b(nine|9)\b/g, "9")
    .replace(/\s+/g, " "); // Collapse whitespace
};

const verifyAttempt = (input: string, q: Question): { verdict: Verdict; points: number } => {
  const normInput = normalize(input);
  const normCorrect = normalize(q.answer);
  const acceptable = (q.acceptableAnswers || []).map(normalize);

  // Exact match first
  let isCorrect = normInput === normCorrect || acceptable.includes(normInput);

  // Fuzzy match if not exact
  if (!isCorrect && normInput.length > 2) {
    const similarity = stringSimilarity.compareTwoStrings(normInput, normCorrect);
    // 0.8 is a good threshold for typos but enough to prevent wild guesses
    if (similarity > 0.8) isCorrect = true;

    // Check acceptable variants with fuzzy logic too
    if (!isCorrect) {
      for (const variant of acceptable) {
        if (stringSimilarity.compareTwoStrings(normInput, variant) > 0.8) {
          isCorrect = true;
          break;
        }
      }
    }
  }

  if (isCorrect) {
    const p = q.difficulty === "Easy" ? 1 : q.difficulty === "Medium" ? 2 : 3;
    return { verdict: "CORRECT", points: p };
  } else {
    const p = q.difficulty === "Easy" ? -1 : q.difficulty === "Medium" ? -2 : -3;
    return { verdict: "INCORRECT", points: p };
  }
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>({
    teams: [],
    questions: [],
    categories: [],
    selectedCategory: "All",
    currentQuestionIndex: 0,
    phase: "SETUP",
    activeTeamId: null,
    typedAnswer: "",
    currentAttempt: null,
    numRounds: 10
  });

  // Load questions including custom ones
  useEffect(() => {
    const storedVersion = localStorage.getItem(STORAGE_KEY_VERSION);
    const currentVersion = storedVersion ? parseInt(storedVersion, 10) : 0;
    
    // If version changed, clear old cached questions and use fresh data from questions.json
    if (currentVersion < QUESTIONS_VERSION) {
      localStorage.removeItem(STORAGE_KEY_QUESTIONS);
      localStorage.setItem(STORAGE_KEY_VERSION, String(QUESTIONS_VERSION));
    }
    
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    let allQuestions = [...initialQuestions] as Question[];

    if (stored) {
      const custom = JSON.parse(stored);
      // Only keep truly custom questions (those not in initialQuestions)
      const initialIds = new Set(initialQuestions.map(q => q.id));
      const customOnly = custom.filter((q: Question) => !initialIds.has(q.id));
      // Use fresh initial questions + any custom user-added questions
      allQuestions = [...initialQuestions, ...customOnly];
    }

    const categories = Array.from(new Set(allQuestions.map(q => q.category))).sort();
    setState(s => ({ ...s, questions: allQuestions, categories: ["All", ...categories] }));
  }, []);

  const addTeam = (name: string) => {
    setState(prev => ({
      ...prev,
      teams: [...prev.teams, { id: crypto.randomUUID(), name, score: 0, questionCount: 0, lastRoundDelta: 0 }]
    }));
  };

  const removeTeam = (id: string) => {
    setState(prev => ({
      ...prev,
      teams: prev.teams.filter(t => t.id !== id)
    }));
  };

  const setCategory = (category: string) => setState(s => ({ ...s, selectedCategory: category }));
  const setNumRounds = (rounds: number) => setState(s => ({ ...s, numRounds: rounds }));

  const startGame = () => {
    setState(prev => {
      // Filter questions based on category and shuffle
      let filtered = prev.selectedCategory === "All"
        ? [...prev.questions]
        : prev.questions.filter(q => q.category === prev.selectedCategory);

      // Shuffle
      filtered = filtered.sort(() => Math.random() - 0.5);

      // Limit to number of rounds * teams
      const totalNeeded = prev.numRounds * prev.teams.length;
      const finalQuestions = filtered.slice(0, totalNeeded);

      return {
        ...prev,
        questions: finalQuestions,
        phase: "QUESTION",
        activeTeamId: prev.teams[0].id,
        currentQuestionIndex: 0
      };
    });
  };

  const setTypedAnswer = (text: string) => setState(s => ({ ...s, typedAnswer: text }));

  const submitAnswer = () => {
    setState((prev) => {
      if (prev.phase !== "QUESTION" || !prev.activeTeamId) return prev;

      const currentQ = prev.questions[prev.currentQuestionIndex];
      const { verdict, points } = verifyAttempt(prev.typedAnswer, currentQ);

      const attempt: Attempt = {
        questionId: currentQ.id,
        teamId: prev.activeTeamId,
        submittedAnswer: prev.typedAnswer,
        verdict,
        pointsDelta: points,
        processed: false
      };

      return {
        ...prev,
        phase: "REVEAL",
        currentAttempt: attempt
      };
    });
  };

  const passQuestion = () => {
    setState((prev) => {
      if (prev.phase !== "QUESTION" || !prev.activeTeamId) return prev;

      const currentQ = prev.questions[prev.currentQuestionIndex];

      const attempt: Attempt = {
        questionId: currentQ.id,
        teamId: prev.activeTeamId,
        submittedAnswer: null,
        verdict: "PASS",
        pointsDelta: 0,
        processed: false
      };

      return {
        ...prev,
        phase: "REVEAL",
        currentAttempt: attempt,
        typedAnswer: ""
      };
    });
  };

  const advanceToScoreUpdate = () => {
    setState((prev) => {
      if (prev.phase !== "REVEAL" || !prev.currentAttempt || prev.currentAttempt.processed) return prev;

      const attempt = prev.currentAttempt;
      const updatedTeams = prev.teams.map(t => {
        if (t.id === attempt.teamId) {
          return {
            ...t,
            score: t.score + attempt.pointsDelta,
            questionCount: t.questionCount + 1,
            lastRoundDelta: attempt.pointsDelta
          };
        }
        return { ...t, lastRoundDelta: 0 };
      });

      const processedAttempt = { ...attempt, processed: true };

      const activeTeam = updatedTeams.find(t => t.id === prev.activeTeamId);
      let nextActiveTeamId = prev.activeTeamId;

      if (activeTeam && activeTeam.questionCount % QUESTIONS_PER_TEAM_ROTATION === 0) {
        const currentTeamIndex = updatedTeams.findIndex(t => t.id === prev.activeTeamId);
        const nextTeamIndex = (currentTeamIndex + 1) % updatedTeams.length;
        nextActiveTeamId = updatedTeams[nextTeamIndex].id;
      }

      const nextIndex = prev.currentQuestionIndex + 1;
      let nextPhase: Phase = "QUESTION";

      const questionsPerRound = prev.teams.length * QUESTIONS_PER_TEAM_ROTATION;
      const isRoundComplete = nextIndex % questionsPerRound === 0;

      if (nextIndex >= prev.questions.length) {
        nextPhase = "GAME_OVER";
      } else if (isRoundComplete) {
        nextPhase = "ROUND_SCORE";
      } else {
        const questionsPerRound = updatedTeams.length * QUESTIONS_PER_TEAM_ROTATION;
        const roundComplete = questionsPerRound > 0 && nextIndex % questionsPerRound === 0;
        if (roundComplete) {
          nextPhase = "SCORE_UPDATE";
        }
      }

      return {
        ...prev,
        teams: updatedTeams,
        currentAttempt: processedAttempt,
        currentQuestionIndex: nextIndex,
        activeTeamId: nextActiveTeamId,
        phase: nextPhase,
        typedAnswer: "",
      };
    });
  };

  const continueToNextRound = () => {
    setState((prev) => ({
      ...prev,
      phase: "QUESTION"
    }));
  };

  const endGame = () => {
    setState(prev => ({ ...prev, phase: "GAME_OVER" }));
  };

  const resetGame = () => {
    setState((prev) => ({
      ...prev,
      phase: "SETUP",
      teams: [],
      questions: [],
      selectedCategory: "All",
      currentQuestionIndex: 0,
      activeTeamId: null,
      typedAnswer: "",
      currentAttempt: null,
      numRounds: 10
    }));
  };

  const addQuestion = (q: Question) => {
    setState((prev) => {
      const updated = [q, ...prev.questions];
      localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(updated));
      return { ...prev, questions: updated };
    });
  };

  const updateQuestion = (updatedQ: Question) => {
    setState((prev) => {
      const updated = prev.questions.map(q => q.id === updatedQ.id ? updatedQ : q);
      localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(updated));
      return { ...prev, questions: updated };
    });
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
        advanceToScoreUpdate,
        continueToNextRound,
        endGame,
        resetGame,
        addQuestion,
        updateQuestion
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
