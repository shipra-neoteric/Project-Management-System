import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { changeEvents } from './middleware/changeEvents';
import { errorHandler, notFoundHandler, requestId } from './middleware/errors';
import { authRouter } from './routes/auth';
import { meetingsRouter } from './routes/meetings';
import { dashboardRouter } from './routes/dashboard';
import { projectsRouter } from './routes/projects';
import { resourcesRouter } from './routes/resources';
import { settingsRouter } from './routes/settings';
import { tasksRouter } from './routes/tasks';
import { usersRouter } from './routes/users';
import { searchRouter } from './routes/search';
import { viewsRouter } from './routes/views';
import { workSettingsRouter } from './routes/workSettings';
import { attachmentsRouter } from './routes/attachments';
import { notificationsRouter } from './routes/notifications';
import { projectViewsRouter } from './routes/projectViews';
import { taskActivityRouter } from './routes/taskActivity';
import { accessRouter } from './routes/access';
import { financeRouter } from './routes/finance';
import { timeRouter } from './routes/time';
import { icalRouter, jobsRouter, schedulingRouter } from './routes/scheduling';
import { auditRouter } from './routes/audit';
import { liveStreamRouter, liveTicketRouter } from './routes/live';
import { startAuditTrail } from './services/audit';
import { openapi } from './openapi';
import { apiTokensRouter } from './routes/apiTokens';
import { ssoRouter } from './routes/sso';
import { webhooksRouter } from './routes/webhooks';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render sits behind a proxy (needed for rate limiting by IP)
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (no Origin) and configured frontends.
        if (!origin || env.allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
        callback(null, false);
      },
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  // Publishes an event after every successful change (live updates, webhooks, audit trail listen).
  app.use(changeEvents);

  app.get('/', (_req, res) => {
    res.json({ name: 'Project Management System API', health: '/api/health' });
  });
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', requireAuth, usersRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/projects/:id/tasks/:taskId/attachments', requireAuth, attachmentsRouter);
  app.use('/api/projects/:id/tasks/:taskId', requireAuth, taskActivityRouter);
  app.use('/api/projects/:id/tasks', requireAuth, tasksRouter);
  app.use('/api/projects/:id/resources', requireAuth, resourcesRouter);
  app.use('/api/projects/:id/views', requireAuth, viewsRouter);
  app.use('/api/work-settings', requireAuth, workSettingsRouter);
  app.use('/api/search', requireAuth, searchRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/project-views', requireAuth, projectViewsRouter);
  app.use('/api/projects/:id', requireAuth, financeRouter);
  app.use('/api/projects', requireAuth, projectsRouter);
  // [import-scheduling routes]
  app.use('/api/ical', icalRouter); // public: the secret token in the URL identifies the person
  app.use('/api/jobs', jobsRouter); // public: protected by X-Cron-Secret
  app.use('/api', schedulingRouter); // signs in on its own paths only (/import, /reminders, /calendar-feed)
  // [collaboration routes]
  app.use('/api/projects/:id/meetings', requireAuth, meetingsRouter);
  // [security-integrations routes]
  app.use('/api/auth/sso', ssoRouter); // public: OpenID Connect sign-in
  app.get('/api/openapi.json', (_req, res) => void res.json(openapi)); // public: API description
  app.use('/api/tokens', requireAuth, apiTokensRouter);
  app.use('/api/webhooks', requireAuth, webhooksRouter);
  // [platform routes]
  startAuditTrail();
  app.use('/api/events', liveStreamRouter); // authenticated by a single-use ticket, not the JWT
  app.use('/api/events', requireAuth, liveTicketRouter);
  app.use('/api/audit', requireAuth, auditRouter);
  app.use('/api', requireAuth, timeRouter);
  app.use('/api', requireAuth, accessRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
