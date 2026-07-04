import { Link } from 'wouter';
import { toast } from 'sonner';
import { Copy, DoorOpen, Play } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { EndRoomResponse, RoomSnapshot, StartRoomResponse } from '@shared/models/rooms';

import { PlayerRoster } from './PlayerRoster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type LobbySnapshot = Extract<RoomSnapshot, { phase: 'LOBBY' }>;

export interface LobbyProps {
  snapshot: LobbySnapshot;
  currentPlayerId: string;
  start: UseMutationResult<StartRoomResponse, Error, void>;
  end: UseMutationResult<EndRoomResponse, Error, void>;
}

export function Lobby({ snapshot, currentPlayerId, start, end }: LobbyProps) {
  const isHost = snapshot.hostPlayerId === currentPlayerId;
  const activePlayers = snapshot.players.filter((player) => !player.leftAt);
  const canStart = activePlayers.length >= 2;

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
    start.mutate(undefined, {
      onError: (error) => toast.error(error.message || 'Failed to start game. Please try again.'),
    });
  };

  const handleClose = () => {
    if (end.isPending) return;
    end.mutate(undefined, {
      onError: (error) => toast.error(error.message || 'Failed to close room. Please try again.'),
    });
  };

  if (snapshot.status !== 'lobby') {
    return (
      <Card
        className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-md"
        data-testid="lobby-closed"
      >
        <CardHeader>
          <CardTitle>Room Closed</CardTitle>
          <CardDescription>The host has closed this room.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/">
            <Button className="w-full" data-testid="link-home">
              Back to Home
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <Card className="border-white/10 bg-white/5 backdrop-blur-md shadow-2xl">
        <CardHeader className="text-center">
          <CardDescription>Room Code</CardDescription>
          <CardTitle
            className="text-5xl font-extrabold tracking-[0.3em] py-2"
            data-testid="text-room-code"
          >
            {snapshot.code}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full border-white/10 hover:bg-white/10"
            onClick={handleCopyLink}
            data-testid="button-copy-link"
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy Join Link
          </Button>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Settings</CardTitle>
          <CardDescription>
            {snapshot.category} &middot; {snapshot.numRounds} rounds
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Players ({activePlayers.length}/4)</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerRoster players={snapshot.players} currentPlayerId={currentPlayerId} />
        </CardContent>
      </Card>

      {isHost ? (
        <div className="space-y-3">
          <Button
            className="w-full h-14 text-lg font-bold"
            disabled={!canStart || start.isPending}
            onClick={handleStart}
            data-testid="button-start-game"
          >
            <Play className="w-5 h-5 mr-2" />
            {start.isPending ? 'Starting...' : 'Start Game'}
          </Button>
          {!canStart && (
            <p
              className="text-center text-sm text-muted-foreground"
              data-testid="text-need-players"
            >
              Need at least 2 players
            </p>
          )}
          <Button
            variant="outline"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
            disabled={end.isPending}
            onClick={handleClose}
            data-testid="button-close-room"
          >
            <DoorOpen className="w-4 h-4 mr-2" />
            Close Room
          </Button>
        </div>
      ) : (
        <p className="text-center text-muted-foreground" data-testid="text-waiting-host">
          Waiting for host to start…
        </p>
      )}
    </div>
  );
}
