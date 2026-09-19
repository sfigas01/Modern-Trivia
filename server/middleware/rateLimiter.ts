import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../types';

const ROOM_PRESENCE_LIMIT_PER_MINUTE = 600;

function isRoomPresencePoll(req: Request): boolean {
  if (req.method !== 'GET') return false;

  const path = req.originalUrl.split('?', 1)[0];
  return /^\/api\/rooms\/[^/]+\/?$/.test(path);
}

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? 'unknown'),
  // Active room clients poll every two seconds to receive snapshots and update
  // their presence. Several players commonly share one public IP, so counting
  // these reads against the general API budget disconnects healthy rooms.
  skip: isRoomPresencePoll,
});

export const roomPresenceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: ROOM_PRESENCE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many room updates, please try again later.' },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? 'unknown'),
  skip: (req: Request) => !isRoomPresencePoll(req),
});

export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'AI analysis rate limit exceeded. Please wait before trying again.',
  },
  keyGenerator: (req: Request) => {
    const userId = (req as AuthenticatedRequest).user?.claims?.sub;
    if (userId) return userId;
    return ipKeyGenerator(req.ip ?? 'unknown');
  },
});
