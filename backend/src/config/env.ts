import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas connection string)'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  // Optional — without SMTP, emails are printed to the server log instead of being sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Project Management System <no-reply@example.com>'),
  /** Public URL of the frontend, used in email links. Defaults to the first FRONTEND_URL. */
  APP_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nInvalid environment configuration:\n${problems}\n\nCopy backend/.env.example to backend/.env and fill it in.\n`);
  process.exit(1);
}

const allowedOrigins = parsed.data.FRONTEND_URL.split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  allowedOrigins,
  appUrl: (parsed.data.APP_URL ?? allowedOrigins[0] ?? 'http://localhost:3000').replace(/\/$/, ''),
  smtpConfigured: !!parsed.data.SMTP_HOST,
};
