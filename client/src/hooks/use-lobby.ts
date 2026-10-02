import { useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  EndRoomResponse,
  LeaveRoomResponse,
  RoomSnapshot,
  StartRoomRequest,
  StartRoomResponse,
} from '@shared/models/rooms';

import { clearRoomSession } from '@/lib/room-session';
import { getGuestSeenIds } from '@/lib/guest-seen';

export type LobbySnapshot = Extract<RoomSnapshot, { phase: 'LOBBY' }>;

export interface LobbyProps {
  snapshot: LobbySnapshot;
  currentPlayerId: string;
  start: UseMutationResult<StartRoomResponse, Error, StartRoomRequest>;
  end: UseMutationResult<EndRoomResponse, Error, void>;
  leave: UseMutationResult<LeaveRoomResponse, Error, void>;
}

// State and handlers for the room lobby, shared by the classic and pixel
// (VITE_PIXEL_UI) layouts.
export function useLobby({ snapshot, currentPlayerId, start, end, leave }: LobbyProps) {
  const [, setLocation] = useLocation();
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const activePlayers = snapshot.players.filter((player) => !player.leftAt);
  const canStart = activePlayers.length >= 2;

  // Scanning lands on the home page, which forwards `?code=` to the join form
  // with the code pre-filled (STE-288).
  const inviteUrl = `${window.location.origin}/?code=${encodeURIComponent(snapshot.code)}`;

  const handleCopyLink = async () => {
    const link = `${window.location.origin}/join/${snapshot.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Join link copied to clipboard!');
    } catch {
      toast.error('Could not copy link. Please copy it manually.');
    }
  };

  const handleStart = () => {
    if (!canStart || start.isPending) return;
    start.mutate(
      { excludeQuestionIds: getGuestSeenIds() },
      {
        onError: (error) => toast.error(error.message || 'Failed to start game. Please try again.'),
      }
    );
  };

  const handleClose = () => {
    if (end.isPending) return;
    end.mutate(undefined, {
      onError: (error) => toast.error(error.message || 'Failed to close room. Please try again.'),
    });
  };

  const handleLeaveConfirm = () => {
    leave.mutate(undefined, {
      onSuccess: () => {
        clearRoomSession(snapshot.code);
        setLocation('/');
      },
      onError: (error) => toast.error(error.message || 'Failed to leave room. Please try again.'),
    });
  };

  const settingsSummary = [
    snapshot.theme ? `Theme: ${snapshot.theme}` : null,
    snapshot.categories.includes('All') ? 'All categories' : snapshot.categories.join(', '),
    `${snapshot.numRounds} rounds`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    isHost,
    activePlayers,
    canStart,
    inviteUrl,
    settingsSummary,
    handleCopyLink,
    handleStart,
    handleClose,
    handleLeaveConfirm,
    showLeaveModal,
    openLeaveModal: () => setShowLeaveModal(true),
    closeLeaveModal: () => setShowLeaveModal(false),
    isStarting: start.isPending,
    isClosing: end.isPending,
    isLeaving: leave.isPending,
  };
}
