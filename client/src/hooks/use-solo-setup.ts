import { useState } from 'react';
import { useLocation } from 'wouter';
import { useGame, QUESTIONS_PER_TEAM_ROTATION } from '@/lib/store';
import { useAccount } from '@/hooks/use-account';
import { useCategoryCounts } from '@/hooks/use-category-counts';

// Shared state and handlers for the solo setup screen, so the classic and
// pixel (VITE_PIXEL_UI) layouts render the same behavior.
export function useSoloSetup() {
  const [, setLocation] = useLocation();
  const { state, addTeam, removeTeam, toggleCategory, setNumRounds, startGame } = useGame();
  const account = useAccount();
  const { isAuthenticated } = account;
  const [newTeamName, setNewTeamName] = useState('');

  const categoryCounts = useCategoryCounts(state.questions);

  const totalNeeded = state.numRounds * state.teams.length * QUESTIONS_PER_TEAM_ROTATION;
  const availableCount =
    state.selectedCategories.length === 0
      ? categoryCounts['All'] || 0
      : state.selectedCategories.reduce((sum, cat) => sum + (categoryCounts[cat] || 0), 0);
  const hasInsufficientQuestions =
    state.teams.length >= 2 && availableCount < totalNeeded && availableCount > 0;

  // Subject of the "not enough questions" warning sentence.
  const insufficientSubject =
    state.selectedCategories.length === 0
      ? 'All categories have'
      : state.selectedCategories.length === 1
        ? `"${state.selectedCategories[0]}" has`
        : `The selected categories have`;

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTeamName.trim()) {
      addTeam(newTeamName.trim());
      setNewTeamName('');
    }
  };

  const handleStart = async () => {
    await startGame(isAuthenticated);
    setLocation('/game');
  };

  const statusLabel =
    state.phase === 'SETUP'
      ? 'Not Started'
      : state.phase === 'GAME_OVER'
        ? 'Completed'
        : 'In Progress';

  return {
    ...account,
    state,
    removeTeam,
    toggleCategory,
    setNumRounds,
    newTeamName,
    setNewTeamName,
    categoryCounts,
    totalNeeded,
    availableCount,
    hasInsufficientQuestions,
    insufficientSubject,
    handleAddTeam,
    handleStart,
    statusLabel,
  };
}
