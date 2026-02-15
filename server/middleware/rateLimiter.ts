import rateLimit from "express-rate-limit";
import type { Request } from "express";
import type { AuthenticatedRequest } from "../types";

/**
 * General API rate limiter — applied to all /api/* routes.
 * 100 requests per minute per IP address.
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
  keyGenerator: (req: Request) => req.ip || "unknown",
});

/**
 * Strict rate limiter for AI-powered endpoints (e.g. OpenAI GPT-4o).
 * 10 requests per 15 minutes per authenticated user.
 *
 * Applied after isAuthenticated + isAdmin middleware so that
 * unauthenticated/non-admin requests are rejected before consuming tokens.
 */
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "AI analysis rate limit exceeded. Please wait before trying again.",
  },
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.claims?.sub || req.ip || "unknown";
  },
});
