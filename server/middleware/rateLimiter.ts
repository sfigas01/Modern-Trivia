import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../types';

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? 'unknown'),
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
