import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { GlobalPermission } from '../models/Access';
import { ApiToken } from '../models/Security';
import { User, type UserDoc } from '../models/User';
import { attachAccess, hasGlobal, loadRoles } from '../services/permissions';
import { forbidden, HttpError } from '../utils/http';

const unauthenticated = (message = 'Please sign in') => new HttpError(401, 'UNAUTHENTICATED', message);

export function signToken(user: UserDoc): string {
  return jwt.sign({ sub: user._id.toString() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

const API_TOKEN_PREFIX = 'pms_';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resolves a personal access token ("pms_…") to its user id, enforcing expiry and scope. */
async function userIdFromApiToken(req: Request, token: string): Promise<string> {
  const record = await ApiToken.findOne({ tokenHash: createHash('sha256').update(token).digest('hex') });
  if (!record) throw unauthenticated('Invalid API token');
  if (record.expiresAt && record.expiresAt < new Date()) throw unauthenticated('This API token has expired');
  if (record.scope === 'read' && !READ_METHODS.has(req.method)) throw forbidden('This API token is read-only');
  // Record usage at most once a minute.
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
    await ApiToken.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } });
  }
  return String(record.user);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthenticated();

  let userId: string;
  if (token.startsWith(API_TOKEN_PREFIX)) {
    userId = await userIdFromApiToken(req, token);
    res.locals.authVia = 'token';
  } else {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      // Short-lived tokens with a purpose (e.g. the 2FA challenge) are not sessions.
      if (payload.purpose) throw new Error('not a session');
      userId = String(payload.sub);
    } catch {
      throw unauthenticated('Your session has expired. Please sign in again.');
    }
    res.locals.authVia = 'session';
  }

  const user = await User.findById(userId);
  if (!user || !user.isActive || user.kind === 'placeholder') throw unauthenticated('Your account is not active');
  await loadRoles();
  await attachAccess(user);
  req.user = user;
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'Admin') throw forbidden('Only administrators can do this');
  next();
}

/** Blocks API tokens from sensitive account actions (creating tokens, changing password or 2FA). */
export function requireSession(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.authVia === 'token') throw forbidden('Sign in to the app to do this; API tokens cannot');
  next();
}

/** Requires an organisation-wide permission (administrators always pass). */
export function requireGlobal(perm: GlobalPermission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !hasGlobal(req.user, perm)) throw forbidden('You don’t have permission to do this');
    next();
  };
}
