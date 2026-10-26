import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env';
import { signToken } from '../middleware/auth';
import { SsoState } from '../models/Security';
import { User } from '../models/User';
import { auditSecurity } from '../services/audit';

/**
 * Single sign-on with any OpenID Connect provider (authorization code flow + PKCE).
 * Mounted (public) at /api/auth/sso.
 */
export const ssoRouter = Router();

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discovery: { doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet>; loadedAt: number } | null = null;

/** Provider metadata from /.well-known/openid-configuration (cached for an hour). */
async function provider() {
  if (discovery && Date.now() - discovery.loadedAt < 60 * 60 * 1000) return discovery;
  const issuer = env.OIDC_ISSUER!.replace(/\/$/, '');
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OpenID discovery failed (${res.status})`);
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error('OpenID discovery document is incomplete');
  discovery = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), loadedAt: Date.now() };
  return discovery;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const random = () => b64url(randomBytes(32));

function redirectUri(req: Request) {
  return env.OIDC_REDIRECT_URI ?? `${req.protocol}://${req.get('host')}/api/auth/sso/callback`;
}

/** Back to the login page with a readable error (never a token in a query string). */
const failUrl = (message: string) => `${env.appUrl}/login?sso_error=${encodeURIComponent(message)}`;

ssoRouter.get('/config', (_req, res) => {
  res.json({ enabled: env.ssoConfigured, label: env.OIDC_DISPLAY_NAME });
});

ssoRouter.get('/start', async (req, res) => {
  if (!env.ssoConfigured) return res.redirect(failUrl('Single sign-on is not set up'));
  let p;
  try {
    p = await provider();
  } catch (err) {
    console.error('[sso]', err);
    return res.redirect(failUrl('The sign-in provider could not be reached. Try again later.'));
  }
  const state = random();
  const nonce = random();
  const verifier = random();
  const uri = redirectUri(req);
  await SsoState.create({ state, nonce, verifier, redirectUri: uri });
  const url = new URL(p.doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.OIDC_CLIENT_ID!,
    redirect_uri: uri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(url.toString());
});

ssoRouter.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query as Record<string, string | undefined>;
  if (error) return res.redirect(failUrl(errorDescription || 'Sign-in was cancelled'));
  if (!env.ssoConfigured || !code || !state) return res.redirect(failUrl('Invalid sign-in response'));

  // One-time use: the state record is deleted as it is read.
  const pending = await SsoState.findOneAndDelete({ state: String(state) });
  if (!pending || Date.now() - pending.createdAt.getTime() > 10 * 60 * 1000) return res.redirect(failUrl('Your sign-in took too long. Please try again.'));

  let claims: JWTPayload & { email?: string; email_verified?: boolean; name?: string; preferred_username?: string };
  try {
    const p = await provider();
    const tokenRes = await fetch(p.doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: pending.redirectUri,
        client_id: env.OIDC_CLIENT_ID!,
        client_secret: env.OIDC_CLIENT_SECRET!,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string };
    if (!tokenRes.ok || !tokens.id_token) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const { payload } = await jwtVerify(tokens.id_token, p.jwks, { issuer: p.doc.issuer, audience: env.OIDC_CLIENT_ID! });
    if (payload.nonce !== pending.nonce) throw new Error('Nonce mismatch');
    claims = payload as typeof claims;
  } catch (err) {
    console.error('[sso] callback failed:', err instanceof Error ? err.message : err);
    return res.redirect(failUrl('Sign-in could not be verified. Please try again.'));
  }

  const subject = `${env.OIDC_ISSUER!.replace(/\/$/, '')}|${claims.sub}`;
  const email = claims.email?.trim().toLowerCase() ?? '';
  const emailTrusted = !!email && claims.email_verified !== false;
  if (env.oidcAllowedDomains.length && !env.oidcAllowedDomains.includes(email.split('@')[1] ?? '')) {
    return res.redirect(failUrl('Your email domain is not allowed to sign in here'));
  }

  // Match by the provider identity first, then link an existing account by verified email.
  let user = await User.findOne({ ssoSubject: subject });
  if (!user && emailTrusted) {
    user = await User.findOne({ email });
    if (user && user.ssoSubject && user.ssoSubject !== subject) user = null;
    if (user) {
      user.ssoSubject = subject;
      if (user.invited) {
        user.invited = false;
        user.inviteTokenHash = null;
      }
      user.emailVerified = true;
      await user.save();
    }
  }
  if (!user) {
    if (!env.OIDC_AUTO_CREATE_USERS || !emailTrusted) return res.redirect(failUrl('There is no account for you yet. Ask an administrator to invite you.'));
    const isFirstUser = (await User.estimatedDocumentCount()) === 0;
    user = await User.create({
      name: (claims.name || claims.preferred_username || email.split('@')[0]).slice(0, 80),
      email,
      ssoSubject: subject,
      emailVerified: true,
      role: isFirstUser ? 'Admin' : 'User',
    });
  }
  if (!user.isActive || user.kind === 'placeholder') return res.redirect(failUrl('Your account has been deactivated. Contact an administrator.'));

  auditSecurity(req, 'auth.sso_login', { id: String(user._id), name: user.name }, { provider: env.OIDC_DISPLAY_NAME });
  // The provider handles MFA, so SSO sign-ins skip the app's own second factor.
  res.redirect(`${env.appUrl}/sso/callback#token=${encodeURIComponent(signToken(user))}`);
});

/** For tests: forget cached provider metadata. */
export const resetSsoDiscovery = () => {
  discovery = null;
};
