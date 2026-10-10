import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  roomCategoriesSchema,
  roomRoundsSchema,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type ThemeSuggestResponse,
} from '@shared/models/rooms';

import { useGame } from '@/lib/store';
import { useCategoryCounts } from '@/hooks/use-category-counts';
import { saveRoomSession } from '@/lib/room-session';
import { getStableGuestSubjectId } from '@/lib/guest-subject';
import { THEME_ROUNDS } from '@/lib/featureFlags';

async function suggestThemeCategories(theme: string): Promise<ThemeSuggestResponse> {
  const res = await fetch('/api/theme/suggest', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      // no JSON body
    }
    throw new Error(message);
  }
  return res.json() as Promise<ThemeSuggestResponse>;
}

async function createRoom(body: CreateRoomRequest): Promise<CreateRoomResponse> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new Error(message);
  }

  return res.json() as Promise<CreateRoomResponse>;
}

// State and handlers for the Host a Game screen, shared by the classic and
// pixel (VITE_PIXEL_UI) layouts.
export function useHostGame() {
  const [, setLocation] = useLocation();
  const { state, toggleCategory, setNumRounds } = useGame();
  const [nickname, setNickname] = useState('');
  const [opponentDisputeVotingEnabled, setOpponentDisputeVotingEnabled] = useState(false);
  const [theme, setTheme] = useState('');

  const categoryCounts = useCategoryCounts(state.questions);

  // Drive the selected-category set toward the suggestions using the existing
  // toggleCategory action, so no shared store change is needed (keeps this
  // additive for the STE-128 redesign).
  const applySuggestedCategories = (suggested: string[]) => {
    const target = new Set(suggested);
    for (const c of state.selectedCategories) {
      if (!target.has(c)) toggleCategory(c);
    }
    for (const c of suggested) {
      if (!state.selectedCategories.includes(c)) toggleCategory(c);
    }
  };

  const suggestMutation = useMutation({
    mutationFn: suggestThemeCategories,
    onSuccess: (response) => {
      applySuggestedCategories(response.categories);
      toast.success('Suggested categories applied — adjust them if you like.');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Could not suggest categories. Please try again.');
    },
  });

  const trimmedTheme = theme.trim();
  const handleSuggest = () => {
    if (trimmedTheme.length < 2 || suggestMutation.isPending) return;
    suggestMutation.mutate(trimmedTheme);
  };

  const createRoomMutation = useMutation({
    mutationFn: createRoom,
    onSuccess: (response) => {
      saveRoomSession({ code: response.code, playerId: response.playerId, token: response.token });
      setLocation(`/room/${response.code}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create room. Please try again.');
    },
  });

  const trimmedNickname = nickname.trim();
  const isNicknameValid = trimmedNickname.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isNicknameValid || createRoomMutation.isPending) return;

    const categoriesValue =
      state.selectedCategories.length === 0 ? ['All'] : state.selectedCategories;
    const categories = roomCategoriesSchema.safeParse(categoriesValue);
    const numRounds = roomRoundsSchema.safeParse(state.numRounds);
    if (!categories.success || !numRounds.success) {
      toast.error('Invalid category or rounds selection. Please try again.');
      return;
    }

    createRoomMutation.mutate({
      nickname: trimmedNickname,
      categories: categories.data,
      numRounds: numRounds.data,
      opponentDisputeVotingEnabled,
      stableGuestSubjectId: getStableGuestSubjectId(),
      // Only sent when the feature is on and the host entered a theme; the
      // server ignores it when the flag is off.
      ...(THEME_ROUNDS && trimmedTheme.length >= 2 ? { theme: trimmedTheme } : {}),
    });
  };

  return {
    state,
    toggleCategory,
    setNumRounds,
    categoryCounts,
    nickname,
    setNickname,
    isNicknameValid,
    theme,
    setTheme,
    trimmedTheme,
    handleSuggest,
    isSuggesting: suggestMutation.isPending,
    opponentDisputeVotingEnabled,
    setOpponentDisputeVotingEnabled,
    handleSubmit,
    isCreating: createRoomMutation.isPending,
    goHome: () => setLocation('/'),
  };
}
