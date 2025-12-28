import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import initialQuestions from "./questions.json";

export type Difficulty = "Easy" | "Medium" | "Hard";
export type Phase = "SETUP" | "QUESTION" | "VERIFYING" | "REVEAL" | "SCORE_UPDATE" | "GAME_OVER";
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
  countryBias: "US" | "CA" | "Mix";
  activeTeamId: string | null;
  typedAnswer: string;
  currentAttempt: Attempt | null;
  numRounds: number;
}

interface GameContextType {
  state: GameState;
  addTeam: (name: string) => void;
  removeTeam: (id: string) => void;
  setCountryBias: (bias: "US" | "CA" | "Mix") => void;
  setCategory: (category: string) => void;
  setNumRounds: (rounds: number) => void;
  startGame: () => void;
  setTypedAnswer: (text: string) => void;
  submitAnswer: () => void;
  passQuestion: () => void;
  advanceToScoreUpdate: () => void;
  resetGame: () => void;
  addQuestion: (q: Question) => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

const STORAGE_KEY_QUESTIONS = "modern_trivia_questions";
const QUESTIONS_PER_TEAM_ROTATION = 4;

const normalize = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[.,!?'"]/g, "") // Remove punctuation
    .replace(/\b(a|an|the)\b/g, "") // Remove articles (simple regex)
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>({
    teams: [],
    questions: [],
    categories: [],
    selectedCategory: "All",
    currentQuestionIndex: 0,
    phase: "SETUP",
    countryBias: "Mix",
    activeTeamId: null,
    typedAnswer: "",
    currentAttempt: null,
    numRounds: 10,
  });

  // Helper to get questions
  const getQuestionPool = () => {
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const customQuestions = stored ? JSON.parse(stored) : [];
    return [...initialQuestions, ...customQuestions] as Question[];
  };

  const loadCategories = useCallback(() => {
    const allQuestions = getQuestionPool();
    const categories = Array.from(new Set(allQuestions.map((q) => q.category))).sort();
    setState((prev) => ({
      ...prev,
      categories,
      selectedCategory:
        prev.selectedCategory === "All" || categories.includes(prev.selectedCategory)
          ? prev.selectedCategory
          : "All",
    }));
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const addTeam = (name: string) => {
    const newTeam: Team = {
      id: crypto.randomUUID(),
      name,
      score: 0,
      questionCount: 0,
      lastRoundDelta: 0,
    };
    setState((prev) => ({ ...prev, teams: [...prev.teams, newTeam] }));
  };

  const removeTeam = (id: string) => {
    setState((prev) => ({ ...prev, teams: prev.teams.filter((t) => t.id !== id) }));
  };

  const setCountryBias = (bias: "US" | "CA" | "Mix") => {
    setState((prev) => ({ ...prev, countryBias: bias }));
  };

  const setCategory = (category: string) => {
    setState((prev) => ({ ...prev, selectedCategory: category }));
  };

  const setNumRounds = (rounds: number) => {
    setState((prev) => ({ ...prev, numRounds: rounds }));
  };

  const addQuestion = (q: Question) => {
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const current = stored ? JSON.parse(stored) : [];
    const updated = [...current, q];
    localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(updated));
    loadCategories();
  };

  const shuffleArray = <T,>(array: T[]): T[] => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const startGame = () => {
    const allQuestions = getQuestionPool();
    let filtered = allQuestions;
    if (state.countryBias !== "Mix") {
      filtered = allQuestions.filter(
        (q) => q.tags.includes("Global") || q.tags.includes(state.countryBias)
      );
    }
    if (state.selectedCategory !== "All") {
      filtered = filtered.filter((q) => q.category === state.selectedCategory);
    }
    const shuffled = shuffleArray(filtered);
    
    // Ensure we load enough questions so each team gets at least 4 questions (one full rotation)
    const minQuestionsNeeded = state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
    const questionsToLoad = Math.max(state.numRounds, minQuestionsNeeded);
    const limited = shuffled.slice(0, questionsToLoad);


    if (state.teams.length === 0) return;

    setState((prev) => ({
      ...prev,
      questions: limited,
      categories: prev.categories,
      selectedCategory: prev.selectedCategory,
      currentQuestionIndex: 0,
      phase: "QUESTION",
      activeTeamId: prev.teams[0].id, // Start with first team
      typedAnswer: "",
      currentAttempt: null,
      teams: prev.teams.map(t => ({ ...t, score: 0, questionCount: 0, lastRoundDelta: 0 }))
    }));
  };

  const setTypedAnswer = (text: string) => {
    setState((prev) => ({ ...prev, typedAnswer: text }));
  };

  const calculatePoints = (difficulty: Difficulty): number => {
    switch (difficulty) {
      case "Easy": return 1;
      case "Medium": return 2;
      case "Hard": return 3;
      default: return 1;
    }
  };

  const verifyAttempt = (
    submittedAnswer: string | null,
    question: Question
  ): { verdict: Verdict; points: number } => {
    if (submittedAnswer === null) {
      return { verdict: "PASS", points: 0 };
    }

    const normalizedInput = normalize(submittedAnswer);
    const possibleAnswers = [question.answer, ...(question.acceptableAnswers || [])];
    
    const isCorrect = possibleAnswers.some(ans => normalize(ans) === normalizedInput);
    const points = calculatePoints(question.difficulty);

    return {
      verdict: isCorrect ? "CORRECT" : "INCORRECT",
      points: isCorrect ? points : -points
    };
  };

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
        phase: "REVEAL", // Skip VERIFYING visual state, do logic immediately
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
        typedAnswer: "" // Clear typed answer on pass? Or keep it? keeping it empty makes sense.
      };
    });
  };

  const advanceToScoreUpdate = () => {
    setState((prev) => {
      if (prev.phase !== "REVEAL" || !prev.currentAttempt || prev.currentAttempt.processed) return prev;

      // Apply Score
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
        return { ...t, lastRoundDelta: 0 }; // Reset others last delta
      });

      // Mark processed
      const processedAttempt = { ...attempt, processed: true };

      // Determine next phase logic (rotate team? next question?)
      const activeTeam = updatedTeams.find(t => t.id === prev.activeTeamId);
      let nextActiveTeamId = prev.activeTeamId;

      if (activeTeam && activeTeam.questionCount % QUESTIONS_PER_TEAM_ROTATION === 0) {
        // Rotate
        const currentTeamIndex = updatedTeams.findIndex(t => t.id === prev.activeTeamId);
        const nextTeamIndex = (currentTeamIndex + 1) % updatedTeams.length;
        nextActiveTeamId = updatedTeams[nextTeamIndex].id;
      }

      const nextIndex = prev.currentQuestionIndex + 1;
      let nextPhase: Phase = "QUESTION";

      if (nextIndex >= prev.questions.length) {
        nextPhase = "GAME_OVER";
      }

      return {
        ...prev,
        teams: updatedTeams,
        currentAttempt: processedAttempt,
        currentQuestionIndex: nextIndex,
        activeTeamId: nextActiveTeamId,
        phase: nextPhase,
        typedAnswer: "", // Clear for next question
      };
    });
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

  return (
    <GameContext.Provider
      value={{
        state,
        addTeam,
        removeTeam,
        setCountryBias,
        setCategory,
        setNumRounds,
        startGame,
        setTypedAnswer,
        submitAnswer,
        passQuestion,
        advanceToScoreUpdate,
        resetGame,
        addQuestion
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
