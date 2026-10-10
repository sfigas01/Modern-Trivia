import type { Request } from 'express';
import type { AuthenticatedRequest } from '../types';
import { ThemeAdmissionError } from './theme-admission';

/** Player generation requires a real sign-in session. Admin API key middleware is not used. */
export function requireThemePlayerSignIn(req: Request): string {
  const userId = (req as AuthenticatedRequest).user?.claims?.sub;
  if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated() || !userId) {
    throw new ThemeAdmissionError(401, 'Sign in to host a themed game');
  }
  return userId;
}
