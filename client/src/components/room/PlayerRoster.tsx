import { motion, AnimatePresence } from 'framer-motion';
import { Crown } from 'lucide-react';
import type { RoomPlayerSnapshot } from '@shared/models/rooms';

import { cn } from '@/lib/utils';

export interface PlayerRosterProps {
  players: RoomPlayerSnapshot[];
  currentPlayerId?: string | null;
  activePlayerId?: string | null;
}

export function PlayerRoster({ players, currentPlayerId, activePlayerId }: PlayerRosterProps) {
  const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);

  return (
    <div className="space-y-2" data-testid="player-roster">
      <AnimatePresence mode="popLayout">
        {sorted.map((player) => {
          const online = player.presence === 'online';
          const stale = player.presence === 'stale';
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
                stale && 'opacity-50',
                isActive && 'ring-2 ring-primary'
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  data-testid={`presence-dot-${player.id}`}
                  aria-label={online ? 'Online' : stale ? 'Stale' : 'Away'}
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    online ? 'bg-green-500' : stale ? 'bg-muted-foreground/40' : 'bg-yellow-400'
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
