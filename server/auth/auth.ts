import { timingSafeEqual } from 'node:crypto';

import passport from 'passport';
import session from 'express-session';
import type { Express, RequestHandler } from 'express';
import connectPg from 'connect-pg-simple';
import MemoryStore from 'memorystore';
import { authStorage, type IAuthStorage } from './storage';
import { createGoogleOidcProvider, type OidcProvider, type PendingSignIn } from './google-oidc';
import type { AuthenticatedUser } from '../types';
import { loadEnvironment } from '../lib/env';

loadEnvironment();

declare module 'express-session' {
  interface SessionData {
    pendingSignIn?: PendingSignIn;
  }
}

export const SESSION_COOKIE_NAME = 'connect.sid';
export const LOGIN_FAILED_REDIRECT = '/?login=failed';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/**
 * Base URL the app is served from, e.g. https://superquestly.up.railway.app.
 * Required in production because the OAuth redirect URI must match the one
 * registered with Google exactly. Local development falls back to localhost.
 */
export function resolvePublicUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.PUBLIC_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (env.NODE_ENV !== 'production') {
    return `http://localhost:${env.PORT || '5000'}`;
  }
  return undefined;
}

function createDefaultProvider(): OidcProvider | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return createGoogleOidcProvider(clientId, clientSecret);
}

export function getSession(): RequestHandler {
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET must be set. Generate one with: openssl rand -hex 32');
  }

  let sessionStore: session.Store;

  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    const pgStore = connectPg(session);
    sessionStore = new pgStore({
      conString: dbUrl,
      createTableIfMissing: false,
      ttl: SESSION_TTL_MS,
      tableName: 'sessions',
      errorLog: (err) => {
        console.error('Session store error:', err.message);
      },
    });
    console.log('Using PostgreSQL session store');
  } else {
    console.warn('DATABASE_URL not set, using memory store');
    const MemoryStoreSession = MemoryStore(session);
    sessionStore = new MemoryStoreSession({
      checkPeriod: SESSION_TTL_MS,
    });
  }

  return session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // 'auto' follows req.secure (behind Railway's proxy via trust proxy), so
      // local development over http still gets a session cookie.
      secure: process.env.NODE_ENV === 'production' ? true : 'auto',
      // Lax is required: Google's redirect back to /api/callback is a
      // cross-site top-level navigation that must carry the session cookie.
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
    },
  });
}

export interface SetupAuthOptions {
  /** Sign-in provider; null means sign-in is not configured. Defaults to Google from env. */
  provider?: OidcProvider | null;
  storage?: IAuthStorage;
  publicUrl?: string;
  session?: RequestHandler;
}

export async function setupAuth(app: Express, options: SetupAuthOptions = {}) {
  const provider = options.provider === undefined ? createDefaultProvider() : options.provider;
  const storage = options.storage ?? authStorage;
  const publicUrl = options.publicUrl ?? resolvePublicUrl();

  if (!provider || !publicUrl) {
    console.error(
      'Google sign-in is not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_URL. Sign-in routes will return 503.'
    );
  }

  const callbackUrl = publicUrl ? `${publicUrl}/api/callback` : undefined;

  app.set('trust proxy', 1);
  app.use(options.session ?? getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get('/api/login', async (req, res) => {
    if (!provider || !callbackUrl) {
      return res.status(503).json({ message: 'Sign-in is not configured' });
    }

    try {
      const { url, pending } = await provider.begin(callbackUrl);
      req.session.pendingSignIn = pending;
      req.session.save((error) => {
        if (error) {
          console.error('Error saving sign-in session:', error);
          return res.status(500).json({ message: 'Failed to start sign-in' });
        }
        res.redirect(url.href);
      });
    } catch (error) {
      console.error('Error starting Google sign-in:', error);
      res.status(503).json({ message: 'Sign-in is temporarily unavailable' });
    }
  });

  app.get('/api/callback', async (req, res) => {
    const fail = (reason: string, error?: unknown) => {
      console.error(`Google sign-in failed: ${reason}`, error ?? '');
      res.redirect(LOGIN_FAILED_REDIRECT);
    };

    if (!provider || !publicUrl) {
      return fail('sign-in is not configured');
    }

    // Single use: a replayed or forged callback finds no pending sign-in.
    const pending = req.session.pendingSignIn;
    delete req.session.pendingSignIn;
    if (!pending) {
      return fail('no sign-in in progress for this session');
    }

    let identity;
    try {
      // Build the URL from PUBLIC_URL so it matches the registered redirect
      // URI regardless of how the proxy reports protocol and host.
      identity = await provider.complete(new URL(req.originalUrl, publicUrl), pending);
    } catch (error) {
      return fail('authorization code exchange was rejected', error);
    }

    if (!identity.emailVerified) {
      return fail('Google account email is not verified');
    }

    let user;
    try {
      user = await storage.upsertUserByEmail({
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        profileImageUrl: identity.picture,
      });
    } catch (error) {
      return fail('could not load or create the user', error);
    }

    // claims.sub is our users.id (not Google's subject). Routes, admin checks
    // and rate limiting all key off it.
    const sessionUser: AuthenticatedUser = {
      claims: { sub: user.id, email: user.email ?? undefined },
    };
    req.login(sessionUser, (error) => {
      if (error) {
        return fail('could not establish the session', error);
      }
      res.redirect('/');
    });
  });

  app.get('/api/logout', (req, res) => {
    req.logout((logoutError) => {
      if (logoutError) {
        console.error('Error signing out:', logoutError);
      }
      req.session.destroy((destroyError) => {
        if (destroyError) {
          console.error('Error destroying session:', destroyError);
        }
        res.clearCookie(SESSION_COOKIE_NAME);
        res.redirect('/');
      });
    });
  });
}

/**
 * Constant-time comparison of a presented bearer token against the configured
 * admin API key. Returns false on any length mismatch without leaking timing.
 */
function bearerTokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  // --- API key auth for scripted admin access (e.g. content quality sweeps) ---
  // When ADMIN_API_KEY is set, a request presenting it via an
  // `Authorization: Bearer <key>` header is authenticated as the admin user
  // identified by ADMIN_API_KEY_USER_ID. This bypasses the session check
  // only — isAdmin still verifies that user ID against the admin_roles table,
  // so the key alone does not grant admin unless the ID is a real admin.
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (adminApiKey) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && bearerTokenMatches(authHeader.slice(7), adminApiKey)) {
      const userId = process.env.ADMIN_API_KEY_USER_ID || 'service-account';
      // Synthetic user so downstream middleware (isAdmin, aiLimiter) works.
      const apiUser: AuthenticatedUser = {
        claims: { sub: userId },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      req.user = apiUser;
      return next();
    }
  }
  // --- End API key auth ---

  const user = req.user as AuthenticatedUser | undefined;
  if (!req.isAuthenticated() || !user?.claims?.sub) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  return next();
};
