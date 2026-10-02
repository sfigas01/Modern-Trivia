import { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { roomCodeSchema, type JoinRoomRequest, type JoinRoomResponse } from '@shared/models/rooms';

import { getGuestSeenIds } from '@/lib/guest-seen';
import { saveRoomSession } from '@/lib/room-session';

async function joinRoom(code: string, body: JoinRoomRequest): Promise<JoinRoomResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
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

  return res.json() as Promise<JoinRoomResponse>;
}

// State and handlers for the Join a Game screen, shared by the classic and
// pixel (VITE_PIXEL_UI) layouts.
export function useJoinGame() {
  const { code: codeFromRoute } = useParams<{ code?: string }>();
  const [, setLocation] = useLocation();
  // The code arrives pre-filled from `/join/:code` or a scanned invite QR
  // (`?code=`, STE-288); the player then only needs a nickname.
  const [initialCode] = useState(() =>
    (codeFromRoute ?? new URLSearchParams(window.location.search).get('code') ?? '')
      .trim()
      .toUpperCase()
  );
  const [code, setCode] = useState(initialCode);
  const isPrefilled = roomCodeSchema.safeParse(initialCode).success;
  const [nickname, setNickname] = useState('');

  const joinRoomMutation = useMutation({
    mutationFn: (body: JoinRoomRequest) => joinRoom(code, body),
    onSuccess: (response) => {
      saveRoomSession({ code, playerId: response.playerId, token: response.token });
      setLocation(`/room/${code}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to join room. Please try again.');
    },
  });

  const trimmedNickname = nickname.trim();
  const isNicknameValid = trimmedNickname.length > 0;
  const isCodeValid = roomCodeSchema.safeParse(code).success;

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(e.target.value.toUpperCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCodeValid || !isNicknameValid || joinRoomMutation.isPending) return;

    // Send this browser's locally-seen question ids so room-wide selection can
    // exclude questions this player has already seen, not just the host's
    // (STE-273). Ignored server-side for signed-in players.
    joinRoomMutation.mutate({
      nickname: trimmedNickname,
      excludeQuestionIds: getGuestSeenIds(),
    });
  };

  return {
    code,
    handleCodeChange,
    isCodeValid,
    isPrefilled,
    // Show the "filled in from your invite" hint until the player edits the code.
    showInviteHint: isPrefilled && code === initialCode,
    nickname,
    setNickname,
    isNicknameValid,
    handleSubmit,
    isJoining: joinRoomMutation.isPending,
    goHome: () => setLocation('/'),
  };
}
