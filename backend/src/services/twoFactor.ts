import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../config/env';
import type { UserDoc } from '../models/User';

// Accept the previous/next 30-second step to allow for clock drift.
authenticator.options = { window: 1 };

const ISSUER = 'Project Management System';
const STEP_MS = 30_000;
const CHALLENGE_TTL = '5m';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newSecret() {
  return authenticator.generateSecret();
}

export async function enrolment(user: UserDoc, secret: string) {
  const otpauthUrl = authenticator.keyuri(user.email ?? user.name, ISSUER, secret);
  return { secret, otpauthUrl, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) };
}

/** Ten one-time backup codes like "4f9k-2m7q" (shown once, stored hashed). */
export function newBackupCodes() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

const normalizeCode = (code: string) => code.trim().toLowerCase().replace(/\s+/g, '');

/**
 * Checks a TOTP code (never the same time step twice) or a backup code (removed once used).
 * The user must be loaded with +totpSecret +totpBackupCodes +totpLastStep. Saves the user on success.
 */
export async function verifySecondFactor(user: UserDoc, rawCode: string, secret = user.totpSecret): Promise<boolean> {
  const code = normalizeCode(rawCode);
  if (/^\d{6}$/.test(code) && secret) {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return false;
    const step = Math.floor(Date.now() / STEP_MS) + delta;
    if (step <= (user.totpLastStep ?? 0)) return false; // replayed code
    user.totpLastStep = step;
    await user.save();
    return true;
  }
  if (/^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(code)) {
    const hash = sha256(code.includes('-') ? code : `${code.slice(0, 4)}-${code.slice(4)}`);
    const codes = user.totpBackupCodes ?? [];
    const index = codes.findIndex((c) => sameHash(c, hash));
    if (index < 0) return false;
    user.totpBackupCodes = codes.filter((_, i) => i !== index);
    await user.save();
    return true;
  }
  return false;
}

/** Short-lived token proving the password was right; exchanged for a session after the second factor. */
export function signChallenge(user: UserDoc) {
  return jwt.sign({ sub: user._id.toString(), purpose: '2fa' }, env.JWT_SECRET, { expiresIn: CHALLENGE_TTL });
}

export function readChallenge(challenge: string): string | null {
  try {
    const payload = jwt.verify(challenge, env.JWT_SECRET) as jwt.JwtPayload;
    return payload.purpose === '2fa' ? String(payload.sub) : null;
  } catch {
    return null;
  }
}
