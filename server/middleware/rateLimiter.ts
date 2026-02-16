import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  keyGenerator: (req: Request) => req.ip || 'unknown',
});

export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'AI analysis rate limit exceeded. Please wait before trying again.',
  },
  keyGenerator: (req: Request) => {
    return (req as any).user?.claims?.sub || req.ip || 'unknown';
  },
});
