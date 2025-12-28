import React, { createContext, useContext, useState, useEffect } from "react";
import initialQuestions from "./questions.json";

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface Question {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  answer: string;
  explanation: string;
  tags: string[];
}

export interface Team {
  id: string;
  name: string;
  score: number;
  lastRoundDelta: number;
}

export interface GameState {
  teams: Team[];
  questions: Question[];
  currentQuestionIndex: number;
  phase: "setup" | "playing" | "summary";
  countryBias: "US" | "CA" | "Mix";
  recentSwingTeamId: string | null;
  activeTeamId: string | null;
  currentTypedAnswer: string;
  isAnswerSubmitted: boolean;
}

interface GameContextType {
  state: GameState;
  addTeam: (name: string) => void;
  removeTeam: (id: string) => void;
  setCountryBias: (bias: "US" | "CA" | "Mix") => void;
  startGame: () => void;
  handleAnswer: (teamId: string, result: "correct" | "incorrect" | "pass") => void;
  nextQuestion: () => void;
  endGame: () => void;
  addQuestion: (q: Question) => void;
  resetGame: () => void;
  setActiveTeam: (id: string | null) => void;
  setTypedAnswer: (text: string) => void;
  submitTypedAnswer: () => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

// Local Storage Keys
const STORAGE_KEY_QUESTIONS = "modern_trivia_questions";

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>({
    teams: [],
    questions: [],
    currentQuestionIndex: 0,
    phase: "setup",
    countryBias: "Mix",
    recentSwingTeamId: null,
    activeTeamId: null,
    currentTypedAnswer: "",
    isAnswerSubmitted: false,
  });

  // Load questions on mount (merge default with local storage)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const customQuestions = stored ? JSON.parse(stored) : [];
    // We don't set state here immediately to avoid overwrite if we want to filter later
    // But for simplicity, we'll just have a "pool" available.
  }, []);

  const addTeam = (name: string) => {
    const newTeam: Team = {
      id: crypto.randomUUID(),
      name,
      score: 0,
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

  const addQuestion = (q: Question) => {
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const current = stored ? JSON.parse(stored) : [];
    const updated = [...current, q];
    localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(updated));
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
    // 1. Gather all questions
    const stored = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const customQuestions = stored ? JSON.parse(stored) : [];
    const allQuestions = [...initialQuestions, ...customQuestions] as Question[];

    // 2. Filter by bias
    let filtered = allQuestions;
    if (state.countryBias !== "Mix") {
      // Keep Global + Specific Country
      filtered = allQuestions.filter(
        (q) => q.tags.includes("Global") || q.tags.includes(state.countryBias)
      );
    }

    // 3. Shuffle
    const shuffled = shuffleArray(filtered);

    setState((prev) => ({
      ...prev,
      questions: shuffled,
      currentQuestionIndex: 0,
      phase: "playing",
      recentSwingTeamId: null,
      activeTeamId: null,
      currentTypedAnswer: "",
      isAnswerSubmitted: false,
      teams: prev.teams.map(t => ({ ...t, score: 0, lastRoundDelta: 0 })) // Reset scores
    }));
  };

  const setActiveTeam = (id: string | null) => {
    setState(prev => ({ ...prev, activeTeamId: id }));
  };

  const setTypedAnswer = (text: string) => {
    setState(prev => ({ ...prev, currentTypedAnswer: text }));
  };

  const submitTypedAnswer = () => {
    setState(prev => ({ ...prev, isAnswerSubmitted: true }));
  };

  const handleAnswer = (teamId: string, result: "correct" | "incorrect" | "pass") => {
    const currentQ = state.questions[state.currentQuestionIndex];
    let points = 0;

    switch (currentQ.difficulty) {
      case "Easy": points = 1; break;
      case "Medium": points = 2; break;
      case "Hard": points = 3; break;
    }

    let delta = 0;
    if (result === "correct") delta = points;
    if (result === "incorrect") delta = -points;
    if (result === "pass") delta = 0;

    setState((prev) => {
      const updatedTeams = prev.teams.map((t) => {
        if (t.id === teamId) {
          return { ...t, score: t.score + delta, lastRoundDelta: delta };
        }
        return { ...t, lastRoundDelta: 0 }; // Reset others
      });

      // Find biggest swing (absolute value? or just who gained/lost most?)
      // Prompt says "highlighting ... biggest swing". Let's assume magnitude.
      // Since only one team answers per "turn" in this logic (implied), they are the swing.
      
      return {
        ...prev,
        teams: updatedTeams,
        recentSwingTeamId: teamId,
        phase: "summary", // Go to summary after an action
      };
    });
  };

  const nextQuestion = () => {
    setState((prev) => {
      const nextIndex = prev.currentQuestionIndex + 1;
      if (nextIndex >= prev.questions.length) {
        // Game Over or Restart? Loop?
        // Let's just Loop for now or End
        return { ...prev, phase: "setup" }; // End game loop
      }
      return {
        ...prev,
        currentQuestionIndex: nextIndex,
        phase: "playing",
        recentSwingTeamId: null,
        activeTeamId: null,
        currentTypedAnswer: "",
        isAnswerSubmitted: false,
      };
    });
  };

  const endGame = () => {
    setState((prev) => ({ ...prev, phase: "setup" }));
  };
  
  const resetGame = () => {
    setState((prev) => ({
      ...prev,
      phase: "setup",
      teams: [],
      questions: [],
      currentQuestionIndex: 0
    }));
  }

  return (
    <GameContext.Provider
      value={{
        state,
        addTeam,
        removeTeam,
        setCountryBias,
        startGame,
        handleAnswer,
        nextQuestion,
        endGame,
        addQuestion,
        resetGame,
        setActiveTeam,
        setTypedAnswer,
        submitTypedAnswer
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
