import * as client from 'openid-client';

const GOOGLE_ISSUER = new URL('https://accounts.google.com');

/** Values the callback must check, stored in the session between login and callback. */
export interface PendingSignIn {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface VerifiedIdentity {
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

export interface OidcProvider {
  /** Start a sign-in: returns the provider URL and the checks to keep in the session. */
  begin(redirectUri: string): Promise<{ url: URL; pending: PendingSignIn }>;
  /** Finish a sign-in: exchanges the code and returns the verified identity. */
  complete(callbackUrl: URL, pending: PendingSignIn): Promise<VerifiedIdentity>;
}

export function createGoogleOidcProvider(clientId: string, clientSecret: string): OidcProvider {
  let configPromise: Promise<client.Configuration> | undefined;

  // Discovery is lazy so the app boots (and serves games) even when Google is
  // unreachable; a failed discovery is retried on the next sign-in.
  const getConfig = () => {
    configPromise ??= client.discovery(GOOGLE_ISSUER, clientId, clientSecret).catch((error) => {
      configPromise = undefined;
      throw error;
    });
    return configPromise;
  };

  return {
    async begin(redirectUri) {
      const config = await getConfig();
      const pending: PendingSignIn = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(pending.codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url, pending };
    },

    async complete(callbackUrl, pending) {
      const config = await getConfig();
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.email !== 'string') {
        throw new Error('Google ID token has no email claim');
      }
      return {
        email: claims.email,
        emailVerified: claims.email_verified === true,
        firstName: typeof claims.given_name === 'string' ? claims.given_name : undefined,
        lastName: typeof claims.family_name === 'string' ? claims.family_name : undefined,
        picture: typeof claims.picture === 'string' ? claims.picture : undefined,
      };
    },
  };
}
