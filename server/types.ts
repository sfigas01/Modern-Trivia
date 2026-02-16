import { Request } from 'express';

export interface UserClaims {
  sub: string;
  email?: string;
  exp?: number;
  [key: string]: any;
}

export interface AuthenticatedUser {
  claims: UserClaims;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
