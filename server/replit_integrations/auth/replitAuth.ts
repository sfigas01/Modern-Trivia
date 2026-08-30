import { timingSafeEqual } from 'node:crypto';

import * as client from 'openid-client';
import { Strategy, type VerifyFunction } from 'openid-client/passport';

import passport from 'passport';
import session from 'express-session';
import type { Express, RequestHandler } from 'express';
import memoize from 'memoizee';
import connectPg from 'connect-pg-simple';
import MemoryStore from 'memorystore';
import { authStorage } from './storage';
import { loadEnvironment } from '../../lib/env';

loadEnvironment();

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? 'https://replit.com/oidc'),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
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
      ttl: sessionTtl,
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
      checkPeriod: sessionTtl,
    });
  }

  return session({
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims['sub'],
    email: claims['email'],
    firstName: claims['first_name'],
    lastName: claims['last_name'],
    profileImageUrl: claims['profile_image_url'],
  });
}

export async function setupAuth(app: Express) {
  app.set('trust proxy', 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: 'openid email profile offline_access',
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get('/api/login', (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: 'login consent',
      scope: ['openid', 'email', 'profile', 'offline_access'],
    })(req, res, next);
  });

  app.get('/api/callback', (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: '/',
      failureRedirect: '/api/login',
    })(req, res, next);
  });

  app.get('/api/logout', (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
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

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // --- API key auth for scripted admin access (e.g. content quality sweeps) ---
  // When ADMIN_API_KEY is set, a request presenting it via an
  // `Authorization: Bearer <key>` header is authenticated as the admin user
  // identified by ADMIN_API_KEY_USER_ID. This bypasses the OIDC session check
  // only — isAdmin still verifies that user ID against the admin_roles table,
  // so the key alone does not grant admin unless the ID is a real admin.
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (adminApiKey) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && bearerTokenMatches(authHeader.slice(7), adminApiKey)) {
      const userId = process.env.ADMIN_API_KEY_USER_ID || 'service-account';
      // Synthetic user so downstream middleware (isAdmin, aiLimiter) works.
      (req as any).user = {
        claims: { sub: userId },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      return next();
    }
  }
  // --- End API key auth ---

  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
};
