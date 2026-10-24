import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { GlobalPermission } from '../models/Access';
import { User, type UserDoc } from '../models/User';
import { attachAccess, hasGlobal, loadRoles } from '../services/permissions';
import { forbidden, HttpError } from '../utils/http';

const unauthenticated = (message = 'Please sign in') => new HttpError(401, 'UNAUTHENTICATED', message);

export function signToken(user: UserDoc): string {
  return jwt.sign({ sub: user._id.toString() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthenticated();

  let userId: string;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    userId = String(payload.sub);
  } catch {
    throw unauthenticated('Your session has expired. Please sign in again.');
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

/** Requires an organisation-wide permission (administrators always pass). */
export function requireGlobal(perm: GlobalPermission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !hasGlobal(req.user, perm)) throw forbidden('You don’t have permission to do this');
    next();
  };
}
