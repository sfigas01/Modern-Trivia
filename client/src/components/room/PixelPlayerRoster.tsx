import type { RoomPlayerSnapshot } from '@shared/models/rooms';

import { PixelAvatar } from '@/components/pixel/Pixel';

// Pixel version of PlayerRoster (STE-234): presence pip, host badge, "(you)",
// "(left)" and score, with the active player outlined. Same test ids.
export function PixelPlayerRoster({
  players,
  currentPlayerId,
  activePlayerId,
}: {
  players: RoomPlayerSnapshot[];
  currentPlayerId?: string | null;
  activePlayerId?: string | null;
}) {
  const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);

  return (
    <ul className="tc-stack tc-roster" data-testid="player-roster">
      {sorted.map((player, index) => {
        const left = !!player.leftAt;
        const online = !left && player.presence === 'online';
        const stale = !left && player.presence === 'stale';
        const isYou = player.id === currentPlayerId;
        const isActive = !left && player.id === activePlayerId;
        const presence = left ? 'Left' : online ? 'Online' : stale ? 'Stale' : 'Away';

        return (
          <li
            key={player.id}
            className="tc-sub tc-player"
            data-testid={`player-row-${player.id}`}
            data-active={isActive || undefined}
            data-faded={stale || left || undefined}
          >
            <PixelAvatar name={player.nickname} index={index} />
            <span
              className="tc-pip"
              data-presence={presence.toLowerCase()}
              data-testid={`presence-dot-${player.id}`}
              aria-label={presence}
              role="img"
            />
            <span className="tc-player__name">
              {player.nickname}
              {isYou && <span className="tc-player__note"> (you)</span>}
              {left && <span className="tc-player__note"> (left)</span>}
            </span>
            {player.isHost && <span className="tc-badge">Host</span>}
            <span className="tc-player__score">{player.score}</span>
          </li>
        );
      })}
    </ul>
  );
}
