import { Link } from 'wouter';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, DoorOpen, LogOut, Play } from 'lucide-react';
import { MAX_PLAYERS } from '@shared/models/rooms';

import { LeaveConfirmModal } from './LeaveConfirmModal';

import { PlayerRoster } from './PlayerRoster';
import { ThemedStartButton } from './ThemedStartButton';
import { useLobby, type LobbyProps } from '@/hooks/use-lobby';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export type { LobbyProps };

export function Lobby(props: LobbyProps) {
  const { snapshot, currentPlayerId } = props;
  const {
    isHost,
    activePlayers,
    canStart,
    inviteUrl,
    handleCopyLink,
    handleStart,
    handleClose,
    handleLeaveConfirm,
    showLeaveModal,
    openLeaveModal,
    closeLeaveModal,
    isStarting,
    isClosing,
    isLeaving,
  } = useLobby(props);

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
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3" data-testid="qr-room-invite">
              <QRCodeSVG
                value={inviteUrl}
                size={220}
                marginSize={1}
                title={`Scan to join room ${snapshot.code}`}
              />
            </div>
            <p className="text-sm text-muted-foreground">Scan with a phone camera to join</p>
          </div>
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
            {snapshot.theme ? <>Theme: {snapshot.theme} &middot; </> : null}
            {snapshot.categories.includes('All')
              ? 'All categories'
              : snapshot.categories.join(', ')}{' '}
            &middot; {snapshot.numRounds} rounds
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-white/10 bg-white/5 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Players ({activePlayers.length}/{MAX_PLAYERS})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerRoster players={snapshot.players} currentPlayerId={currentPlayerId} />
        </CardContent>
      </Card>

      {isHost ? (
        <div className="space-y-3">
          {snapshot.theme ? (
            <ThemedStartButton code={snapshot.code} theme={snapshot.theme} canStart={canStart} />
          ) : (
            <>
              <Button
                className="w-full h-14 text-lg font-bold"
                disabled={!canStart || isStarting}
                onClick={handleStart}
                data-testid="button-start-game"
              >
                <Play className="w-5 h-5 mr-2" />
                {isStarting ? 'Starting...' : 'Start Game'}
              </Button>
              {!canStart && (
                <p
                  className="text-center text-sm text-muted-foreground"
                  data-testid="text-need-players"
                >
                  Need at least 2 players
                </p>
              )}
            </>
          )}
          <Button
            variant="outline"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
            disabled={isClosing}
            onClick={handleClose}
            data-testid="button-close-room"
          >
            <DoorOpen className="w-4 h-4 mr-2" />
            Close Room
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-muted-foreground" data-testid="text-waiting-host">
            Waiting for host to start…
          </p>
          <Button
            variant="outline"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10"
            disabled={isLeaving}
            onClick={openLeaveModal}
            data-testid="button-leave-room"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Leave Room
          </Button>
        </div>
      )}

      {showLeaveModal && (
        <LeaveConfirmModal
          snapshot={snapshot}
          currentPlayerId={currentPlayerId}
          isPending={isLeaving}
          onConfirm={handleLeaveConfirm}
          onCancel={closeLeaveModal}
        />
      )}
    </div>
  );
}
