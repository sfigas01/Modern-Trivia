import { QRCodeSVG } from 'qrcode.react';
import { MAX_PLAYERS } from '@shared/models/rooms';

import { LeaveConfirmModal } from './LeaveConfirmModal';
import { PixelPlayerRoster } from './PixelPlayerRoster';
import { ThemedStartButton } from './ThemedStartButton';
import { useLobby, type LobbyProps } from '@/hooks/use-lobby';
import {
  PixelBusy,
  PixelButton,
  PixelFrame,
  PixelPageHeader,
  PixelScreen,
  pixelButtonClass,
} from '@/components/pixel/Pixel';
import { Link } from 'wouter';

// Pixel-art room lobby (STE-234), rendered by Room.tsx in the LOBBY phase when
// VITE_PIXEL_UI is on. Behavior, copy and test ids match the classic Lobby.
export default function PixelLobby({
  isDisconnected,
  ...props
}: LobbyProps & { isDisconnected?: boolean }) {
  const { snapshot, currentPlayerId } = props;
  const {
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
    openLeaveModal,
    closeLeaveModal,
    isStarting,
    isClosing,
    isLeaving,
  } = useLobby(props);

  if (snapshot.status !== 'lobby') {
    return (
      <PixelScreen>
        <PixelPageHeader title="Room Closed" />
        <section data-testid="lobby-closed" className="tc-stack" style={{ gap: 24 }}>
          <PixelFrame title="Room Closed">
            <p className="tc-hint">The host has closed this room.</p>
          </PixelFrame>
          <Link
            href="/"
            className={pixelButtonClass({ variant: 'coin', size: 'lg', block: true })}
            data-testid="link-home"
          >
            Back to Home
          </Link>
        </section>
      </PixelScreen>
    );
  }

  return (
    <PixelScreen>
      {isDisconnected && (
        <div className="tc-banner" data-testid="text-disconnected" aria-live="polite">
          Connection lost. Reconnecting…
        </div>
      )}

      <PixelPageHeader title="Game Lobby" />

      <PixelFrame title="Room Code">
        <p className="tc-room-code" data-testid="text-room-code">
          {snapshot.code}
        </p>
        <div className="tc-qr" data-testid="qr-room-invite">
          <QRCodeSVG
            value={inviteUrl}
            size={200}
            marginSize={1}
            title={`Scan to join room ${snapshot.code}`}
          />
        </div>
        <p className="tc-hint" style={{ textAlign: 'center' }}>
          Scan with a phone camera to join
        </p>
        <PixelButton
          variant="magenta"
          block
          onClick={handleCopyLink}
          data-testid="button-copy-link"
        >
          Copy Join Link
        </PixelButton>
      </PixelFrame>

      <PixelFrame title="Settings">
        <p className="tc-hint" style={{ textAlign: 'center' }}>
          {settingsSummary}
        </p>
      </PixelFrame>

      <PixelFrame title={`Players (${activePlayers.length}/${MAX_PLAYERS})`}>
        <PixelPlayerRoster players={snapshot.players} currentPlayerId={currentPlayerId} />
      </PixelFrame>

      {isHost ? (
        <div className="tc-stack">
          {snapshot.theme ? (
            // Themed rooms keep the classic start control (generation progress)
            // until overlays and system states are reskinned (STE-233).
            <div className="tc-classic-island">
              <ThemedStartButton code={snapshot.code} theme={snapshot.theme} canStart={canStart} />
            </div>
          ) : (
            <>
              <PixelButton
                variant="red"
                size="lg"
                block
                disabled={!canStart || isStarting}
                onClick={handleStart}
                data-testid="button-start-game"
              >
                {isStarting ? (
                  <>
                    <PixelBusy />
                    Starting...
                  </>
                ) : (
                  'Start Game'
                )}
              </PixelButton>
              {!canStart && (
                <p className="tc-tagline" data-testid="text-need-players">
                  Need at least 2 players
                </p>
              )}
            </>
          )}
          <PixelButton
            variant="stone"
            block
            disabled={isClosing}
            onClick={handleClose}
            data-testid="button-close-room"
          >
            Close Room
          </PixelButton>
        </div>
      ) : (
        <div className="tc-stack">
          <p className="tc-tagline" data-testid="text-waiting-host">
            Waiting for host to start…
          </p>
          <PixelButton
            variant="stone"
            block
            disabled={isLeaving}
            onClick={openLeaveModal}
            data-testid="button-leave-room"
          >
            Leave Room
          </PixelButton>
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
    </PixelScreen>
  );
}
