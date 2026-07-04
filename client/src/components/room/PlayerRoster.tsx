import { motion, AnimatePresence } from 'framer-motion';
import { Crown } from 'lucide-react';
import type { RoomPlayerSnapshot } from '@shared/models/rooms';

import { cn } from '@/lib/utils';

const ONLINE_THRESHOLD_MS = 10_000;

export interface PlayerRosterProps {
  players: RoomPlayerSnapshot[];
  currentPlayerId?: string | null;
  activePlayerId?: string | null;
  now?: number;
}

function isOnline(lastSeenAt: string, now: number): boolean {
  return now - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

export function PlayerRoster({
  players,
  currentPlayerId,
  activePlayerId,
  now = Date.now(),
}: PlayerRosterProps) {
  const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);

  return (
    <div className="space-y-2" data-testid="player-roster">
      <AnimatePresence mode="popLayout">
        {sorted.map((player) => {
          const online = isOnline(player.lastSeenAt, now);
          const isYou = player.id === currentPlayerId;
          const isActive = player.id === activePlayerId;

          return (
            <motion.div
              key={player.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              data-testid={`player-row-${player.id}`}
              className={cn(
                'flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5',
                isActive && 'ring-2 ring-primary'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  data-testid={`presence-dot-${player.id}`}
                  aria-label={online ? 'Online' : 'Offline'}
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    online ? 'bg-green-500' : 'bg-muted-foreground/40'
                  )}
                />
                {player.isHost && <Crown className="w-4 h-4 text-yellow-400 shrink-0" />}
                <span className="font-medium truncate">
                  {player.nickname}
                  {isYou && <span className="text-muted-foreground font-normal"> (you)</span>}
                </span>
              </div>
              <span className="font-bold tabular-nums">{player.score}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
