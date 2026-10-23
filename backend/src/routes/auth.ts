import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAuth, signToken } from '../middleware/auth';
import { publicUser, User, type UserDoc } from '../models/User';
import { renderEmail, sendMail } from '../services/mailer';
import { badRequest, conflict, HttpError, parseBody } from '../utils/http';

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
  void sendMail({ to: user.email, subject: 'Confirm your email address', text, html });
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parseBody(registerSchema, req.body);
  if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists');

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
  const valid = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
  if (!user || !valid) throw new HttpError(401, 'UNAUTHENTICATED', 'Incorrect email or password');
  if (!user.isActive) throw new HttpError(403, 'FORBIDDEN', 'Your account has been deactivated. Contact an administrator.');
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

const DASHBOARD_WIDGETS = ['kpis', 'favorites', 'myTasks', 'portfolio', 'milestones', 'overdue', 'statusChart', 'projectStatusChart', 'workloadChart'] as const;
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  notifyByEmail: z.boolean().optional(),
  dashboardWidgets: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length).nullable().optional(),
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = parseBody(profileSchema, req.body);
  const user = req.user!;
  if (body.name !== undefined) user.name = body.name;
  if (body.notifyByEmail !== undefined) user.notifyByEmail = body.notifyByEmail;
  if (body.dashboardWidgets !== undefined) user.set('dashboardWidgets', body.dashboardWidgets ? [...new Set(body.dashboardWidgets)] : undefined);
  await user.save();
  res.json({ user: publicUser(user) });
});

authRouter.post('/change-password', requireAuth, authLimiter, async (req, res) => {
  const body = parseBody(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: password }), req.body);
  const user = await User.findById(req.user!._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Your current password is incorrect');
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
    void sendMail({ to: user.email, subject: 'Reset your password', text, html });
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
  res.json({ token: signToken(user), user: publicUser(user) });
});
