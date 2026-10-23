import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, signToken } from '../middleware/auth';
import { publicUser, User } from '../models/User';
import { conflict, HttpError, parseBody } from '../utils/http';

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

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

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
