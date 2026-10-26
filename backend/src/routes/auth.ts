import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAdmin, requireAuth, requireSession, signToken } from '../middleware/auth';
import { Setting } from '../models/Setting';
import { publicUser, User, type UserDoc } from '../models/User';
import { enrolment, newBackupCodes, newSecret, readChallenge, sha256, signChallenge, verifySecondFactor } from '../services/twoFactor';
import { renderEmail, sendMail } from '../services/mailer';
import { auditSecurity } from '../services/audit';
import { assertObjectId, badRequest, conflict, HttpError, notFound, parseBody } from '../utils/http';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      error: { message: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED', requestId: req.requestId },
    }),
});

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password,
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

const RESET_TTL_MS = 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('hex');

async function sendVerification(user: UserDoc) {
  const token = newToken();
  user.verifyTokenHash = hashToken(token);
  await user.save();
  const url = `${env.appUrl}/verify-email?token=${token}`;
  const { text, html } = renderEmail('Confirm your email address', [`Hi ${user.name},`, 'Please confirm your email address so we can send you notifications.'], {
    label: 'Confirm email',
    url,
  });
  if (user.email) void sendMail({ to: user.email, subject: 'Confirm your email address', text, html });
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parseBody(registerSchema, req.body);
  const existing = await User.findOne({ email: body.email });
  if (existing?.invited) throw conflict('You have been invited already — use the link in your invitation email to set your password');
  if (existing) throw conflict('An account with this email already exists');

  const isFirstUser = (await User.estimatedDocumentCount()) === 0;
  const user = await User.create({
    name: body.name,
    email: body.email,
    passwordHash: await bcrypt.hash(body.password, 10),
    role: isFirstUser ? 'Admin' : 'User',
  });
  await sendVerification(user);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parseBody(loginSchema, req.body);
  const user = await User.findOne({ email: body.email }).select('+passwordHash');
  const valid = user?.passwordHash ? await bcrypt.compare(body.password, user.passwordHash) : false;
  if (!user || !valid) {
    auditSecurity(req, 'auth.login_failed', user ? { id: String(user._id), name: user.name } : null, { email: body.email });
    throw new HttpError(401, 'UNAUTHENTICATED', 'Incorrect email or password');
  }
  if (!user.isActive) throw new HttpError(403, 'FORBIDDEN', 'Your account has been deactivated. Contact an administrator.');
  auditSecurity(req, user.totpEnabled ? 'auth.login_password_ok' : 'auth.login', { id: String(user._id), name: user.name }, { email: body.email });
  res.json(sessionOrChallenge(user));
});

/** A session — or, when two-factor authentication is on, a short-lived challenge for the second step. */
function sessionOrChallenge(user: UserDoc) {
  if (user.totpEnabled) return { twoFactorRequired: true as const, challenge: signChallenge(user) };
  return { token: signToken(user), user: publicUser(user) };
}

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

// ---- Invitations --------------------------------------------------------------------------------

/** GET /auth/invite?token= — who the invitation is for (prefills the accept form). */
authRouter.get('/invite', authLimiter, async (req, res) => {
  const token = String(req.query.token ?? '');
  const user = token.length >= 10 ? await User.findOne({ inviteTokenHash: hashToken(token), invited: true }) : null;
  if (!user) throw badRequest('This invitation link is invalid or has already been used');
  res.json({ email: user.email, name: user.name });
});

authRouter.post('/accept-invite', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(10).max(200), name: z.string().trim().min(2).max(80), password }), req.body);
  const user = await User.findOne({ inviteTokenHash: hashToken(body.token), invited: true });
  if (!user) throw badRequest('This invitation link is invalid or has already been used');
  user.name = body.name;
  user.passwordHash = await bcrypt.hash(body.password, 10);
  user.invited = false;
  user.inviteTokenHash = null;
  user.emailVerified = true;
  await user.save();
  res.json({ token: signToken(user), user: publicUser(user) });
});

const DASHBOARD_WIDGETS = ['kpis', 'favorites', 'myTasks', 'portfolio', 'milestones', 'overdue', 'statusChart', 'projectStatusChart', 'workloadChart', 'myTime'] as const;
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  notifyByEmail: z.boolean().optional(),
  dashboardWidgets: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length).nullable().optional(),
  workSchedule: z.object({ hoursPerDay: z.number().min(0).max(24), workingDays: z.array(z.number().int().min(0).max(6)).max(7) }).optional(),
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = parseBody(profileSchema, req.body);
  const user = req.user!;
  if (body.name !== undefined) user.name = body.name;
  if (body.notifyByEmail !== undefined) user.notifyByEmail = body.notifyByEmail;
  if (body.workSchedule !== undefined) user.set('workSchedule', body.workSchedule);
  if (body.dashboardWidgets !== undefined) user.set('dashboardWidgets', body.dashboardWidgets ? [...new Set(body.dashboardWidgets)] : undefined);
  await user.save();
  res.json({ user: publicUser(user) });
});

authRouter.post('/change-password', requireAuth, requireSession, authLimiter, async (req, res) => {
  const body = parseBody(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password }), req.body);
  const user = await User.findById(req.user!._id).select('+passwordHash');
  if (!user?.passwordHash || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Your current password is incorrect');
  user.passwordHash = await bcrypt.hash(body.newPassword, 10);
  await user.save();
  res.json({ ok: true });
});

authRouter.post('/resend-verification', requireAuth, authLimiter, async (req, res) => {
  const user = await User.findById(req.user!._id);
  if (user && !user.emailVerified) await sendVerification(user);
  res.json({ ok: true });
});

authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = parseBody(z.object({ token: z.string().min(10).max(200) }), req.body);
  const user = await User.findOne({ verifyTokenHash: hashToken(token) });
  if (!user) throw badRequest('This confirmation link is invalid or has already been used');
  user.emailVerified = true;
  user.verifyTokenHash = null;
  await user.save();
  res.json({ ok: true, user: publicUser(user) });
});

/** Always answers OK so the endpoint can't be used to discover which emails have accounts. */
authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parseBody(z.object({ email: z.string().trim().toLowerCase().min(3).max(200) }), req.body);
  const user = await User.findOne({ email, isActive: true });
  if (user) {
    const token = newToken();
    user.resetTokenHash = hashToken(token);
    user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
    await user.save();
    const { text, html } = renderEmail(
      'Reset your password',
      [`Hi ${user.name},`, 'Someone asked to reset the password for your account. The link below works for 1 hour.', "If it wasn't you, ignore this email — your password stays the same."],
      { label: 'Choose a new password', url: `${env.appUrl}/reset-password?token=${token}` },
    );
    if (user.email) void sendMail({ to: user.email, subject: 'Reset your password', text, html });
  }
  res.json({ ok: true });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const user = await User.findOne({ resetTokenHash: hashToken(body.token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!user) throw badRequest('This reset link is invalid or has expired. Request a new one.');
  user.passwordHash = await bcrypt.hash(body.password, 10);
  user.resetTokenHash = null;
  user.resetTokenExpires = null;
  user.emailVerified = true; // they proved they own the mailbox
  await user.save();
  // A reset link proves the mailbox, not the authenticator: 2FA still applies.
  res.json(sessionOrChallenge(user));
});

// ---- Two-factor authentication (TOTP + backup codes) ------------------------------------------

/** Stricter limit for second-factor attempts (6-digit codes must not be brute-forced). */
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: { message: 'Too many codes tried. Please wait 15 minutes and sign in again.', code: 'RATE_LIMITED', requestId: req.requestId } }),
});

const codeSchema = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code').max(20) });
const withSecrets = (id: unknown) => User.findById(id).select('+totpSecret +totpPendingSecret +totpBackupCodes +totpLastStep +passwordHash');

/** POST /auth/2fa/verify — second sign-in step: { challenge, code } → session. */
authRouter.post('/2fa/verify', twoFactorLimiter, async (req, res) => {
  const body = parseBody(z.object({ challenge: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) }), req.body);
  const userId = readChallenge(body.challenge);
  if (!userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Your sign-in took too long. Please enter your password again.');
  const user = await withSecrets(userId);
  if (!user || !user.isActive || !user.totpEnabled) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (!(await verifySecondFactor(user, body.code))) {
    auditSecurity(req, 'auth.2fa_failed', { id: String(user._id), name: user.name }, {});
    throw new HttpError(401, 'INVALID_CODE', 'That code is not valid. Try the current code from your app or a backup code.');
  }
  res.json({ token: signToken(user), user: publicUser(user), backupCodesLeft: user.totpBackupCodes?.length ?? 0 });
});

authRouter.get('/2fa', requireAuth, async (req, res) => {
  const user = await withSecrets(req.user!._id);
  const org = await Setting.findOne({ key: 'org' }).select('require2fa').lean();
  res.json({ enabled: !!user?.totpEnabled, backupCodesLeft: user?.totpBackupCodes?.length ?? 0, required: !!org?.require2fa, sso: !!user?.ssoSubject });
});

/** Starts enrolment: a new secret (not active until confirmed) with its QR code. */
authRouter.post('/2fa/setup', requireAuth, requireSession, async (req, res) => {
  const user = await withSecrets(req.user!._id);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  if (user.totpEnabled) throw conflict('Two-factor authentication is already on. Turn it off first to set up a new device.');
  const secret = newSecret();
  user.totpPendingSecret = secret;
  await user.save();
  res.json(await enrolment(user, secret));
});

/** Confirms enrolment with a code from the app; returns backup codes (shown once). */
authRouter.post('/2fa/enable', requireAuth, requireSession, twoFactorLimiter, async (req, res) => {
  const { code } = parseBody(codeSchema, req.body);
  const user = await withSecrets(req.user!._id);
  if (!user?.totpPendingSecret) throw badRequest('Start the setup first');
  if (!(await verifySecondFactor(user, code, user.totpPendingSecret))) throw badRequest('That code is not valid. Check the time on your phone and try again.');
  const backupCodes = newBackupCodes();
  user.totpSecret = user.totpPendingSecret;
  user.totpPendingSecret = null;
  user.totpEnabled = true;
  user.totpBackupCodes = backupCodes.map(sha256);
  await user.save();
  res.json({ enabled: true, backupCodes, user: publicUser(user) });
});

/** New set of backup codes (old ones stop working). Needs a current code. */
authRouter.post('/2fa/backup-codes', requireAuth, requireSession, twoFactorLimiter, async (req, res) => {
  const { code } = parseBody(codeSchema, req.body);
  const user = await withSecrets(req.user!._id);
  if (!user?.totpEnabled) throw badRequest('Two-factor authentication is off');
  if (!(await verifySecondFactor(user, code))) throw badRequest('That code is not valid');
  const backupCodes = newBackupCodes();
  user.totpBackupCodes = backupCodes.map(sha256);
  await user.save();
  res.json({ backupCodes });
});

/** Turns 2FA off: needs the password (when the account has one) and a current or backup code. */
authRouter.post('/2fa/disable', requireAuth, requireSession, twoFactorLimiter, async (req, res) => {
  const body = parseBody(z.object({ password: z.string().max(128).optional().default(''), code: z.string().trim().min(6).max(20) }), req.body);
  const user = await withSecrets(req.user!._id);
  if (!user?.totpEnabled) throw badRequest('Two-factor authentication is already off');
  if (user.passwordHash && !(await bcrypt.compare(body.password, user.passwordHash))) throw badRequest('Your password is not correct');
  if (!(await verifySecondFactor(user, body.code))) throw badRequest('That code is not valid');
  const org = await Setting.findOne({ key: 'org' }).select('require2fa').lean();
  if (org?.require2fa && !user.ssoSubject) throw badRequest('Your organisation requires two-factor authentication');
  user.totpEnabled = false;
  user.totpSecret = null;
  user.totpBackupCodes = [];
  await user.save();
  res.json({ enabled: false, user: publicUser(user) });
});

/** Administrators can switch 2FA off for someone who lost their phone and backup codes. */
authRouter.post('/2fa/reset/:userId', requireAuth, requireSession, requireAdmin, async (req, res) => {
  const user = await withSecrets(assertObjectId(req.params.userId, 'User'));
  if (!user) throw notFound('User');
  user.totpEnabled = false;
  user.totpSecret = null;
  user.totpPendingSecret = null;
  user.totpBackupCodes = [];
  await user.save();
  res.json({ user: publicUser(user) });
});
