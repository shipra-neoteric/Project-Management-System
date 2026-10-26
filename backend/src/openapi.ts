/**
 * Public API description (OpenAPI 3.1), served at GET /api/openapi.json and rendered in the app
 * under "API docs". Hand-written for the main resources; every route requires a Bearer token —
 * a personal access token ("pms_…", created under My profile → API tokens) or a session token.
 */

type Json = Record<string, unknown>;

const id = { type: 'string', pattern: '^[a-f0-9]{24}$', example: '6720c1f0a1b2c3d4e5f60718' };
const date = { type: 'string', format: 'date', example: '2026-11-02' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Json, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const body = (schema: Json, required = true) => ({ required, content: { 'application/json': { schema } } });
const pathId = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: id });
const query = (name: string, description: string, schema: Json = { type: 'string' }) => ({ name, in: 'query', required: false, description, schema });

const P = pathId('id', 'Project id');
const T = pathId('taskId', 'Task id');
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
};
const op = (tag: string, summary: string, extra: Json = {}) => ({ tags: [tag], summary, responses: { '200': json({ type: 'object' }), ...errors }, ...extra });

/** Turns the shorthand `nullable: true` into OpenAPI 3.1 / JSON Schema null types. */
function toOpenApi31(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOpenApi31);
  if (!node || typeof node !== 'object') return node;
  const { nullable, ...rest } = node as Json;
  const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, toOpenApi31(v)])) as Json;
  if (!nullable) return out;
  if (typeof out.type === 'string') return { ...out, type: [out.type, 'null'] };
  if (Array.isArray(out.enum)) return { ...out, enum: [...out.enum, null] };
  return { anyOf: [out, { type: 'null' }] };
}

export const openapi = toOpenApi31({
  openapi: '3.1.0',
  info: {
    title: 'Project Management System API',
    version: '1.0.0',
    description:
      'REST API for projects, tasks (Gantt scheduling), time, costs and budgets. Authenticate with `Authorization: Bearer pms_…` using a personal access token from **My profile → API tokens**. Read tokens may only send GET requests. Errors use `{ "error": { "message", "code", "requestId" } }`.',
  },
  servers: [{ url: '/api', description: 'This server' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Authentication', description: 'Who am I; tokens' },
    { name: 'Projects', description: 'Projects, programs and portfolios' },
    { name: 'Members', description: 'People and groups in a project' },
    { name: 'Tasks', description: 'Plan: tasks, links and scheduling. Every change returns the re-scheduled plan.' },
    { name: 'Time', description: 'Time entries' },
    { name: 'Costs', description: 'Cost entries and budgets' },
    { name: 'Reports', description: 'Time and cost reports' },
    { name: 'Users', description: 'People in the organisation' },
    { name: 'Webhooks', description: 'Outgoing change notifications (administrators)' },
  ],
  paths: {
    '/auth/me': { get: op('Authentication', 'The signed-in user', { responses: { '200': json({ type: 'object', properties: { user: ref('User') } }), ...errors } }) },
    '/tokens': {
      get: op('Authentication', 'List your API tokens (sign-in session only)'),
      post: op('Authentication', 'Create an API token (sign-in session only; the token is shown once)', {
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, scope: { enum: ['read', 'write'] }, expiresInDays: { type: 'integer', nullable: true } } }),
      }),
    },
    '/projects': {
      get: op('Projects', 'Projects you can see', { responses: { '200': json({ type: 'object', properties: { projects: { type: 'array', items: ref('Project') } } }), ...errors } }),
      post: op('Projects', 'Create a project', {
        requestBody: body({
          type: 'object',
          required: ['name', 'startDate'],
          properties: { name: { type: 'string' }, description: { type: 'string' }, startDate: date, kind: { enum: ['project', 'program', 'portfolio'] }, parent: { ...id, nullable: true } },
        }),
      }),
    },
    '/projects/{id}': {
      parameters: [P],
      get: op('Projects', 'One project', { responses: { '200': json({ type: 'object', properties: { project: ref('Project') } }), ...errors } }),
      patch: op('Projects', 'Update a project (name, dates, status, calendar, custom values…)', { requestBody: body({ type: 'object' }) }),
      delete: op('Projects', 'Delete a project and everything in it', { responses: { '204': { description: 'Deleted' }, ...errors } }),
    },
    '/projects/{id}/overview': { parameters: [P], get: op('Projects', 'Roll-up figures, sub-projects, milestones and recent activity') },
    '/projects/{id}/members': {
      parameters: [P],
      post: op('Members', 'Add a person or a group', {
        requestBody: body({ type: 'object', required: ['role'], properties: { userId: id, groupId: id, role: { type: 'string', description: 'manager | member | viewer, or a custom role id' } } }),
      }),
    },
    '/projects/{id}/members/{memberId}': {
      parameters: [P, pathId('memberId', 'User or group id')],
      patch: op('Members', 'Change a member’s role', { requestBody: body({ type: 'object', properties: { role: { type: 'string' } } }) }),
      delete: op('Members', 'Remove a member'),
    },
    '/projects/{id}/tasks': {
      parameters: [P],
      get: op('Tasks', 'The scheduled plan', { responses: { '200': json(ref('Plan')), ...errors } }),
      post: op('Tasks', 'Add a task', {
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, duration: { type: 'integer', description: 'Working days (0 = milestone)' }, afterTaskId: { ...id, nullable: true } } }),
        responses: { '200': json({ allOf: [ref('Plan'), { type: 'object', properties: { createdTaskId: id } }] }), ...errors },
      }),
    },
    '/projects/{id}/tasks/{taskId}': {
      parameters: [P, T],
      patch: op('Tasks', 'Update a task (name, duration, links, assignee, status, % complete, work…)', {
        requestBody: body({
          type: 'object',
          properties: {
            name: { type: 'string' },
            duration: { type: 'integer' },
            constraintStart: { ...date, nullable: true },
            percentComplete: { type: 'number', minimum: 0, maximum: 100 },
            predecessors: { type: 'array', items: { type: 'object', properties: { task: id, type: { enum: ['FS', 'SS', 'FF', 'SF'] }, lag: { type: 'integer' } } } },
            assignee: { ...id, nullable: true },
            status: id,
            priority: { enum: ['low', 'normal', 'high', 'immediate'] },
            work: { type: 'number', nullable: true },
            remainingWork: { type: 'number', nullable: true },
          },
        }),
        responses: { '200': json(ref('Plan')), ...errors },
      }),
      delete: op('Tasks', 'Delete a task (and its sub-tasks)', { responses: { '200': json(ref('Plan')), ...errors } }),
    },
    '/projects/{id}/tasks/{taskId}/comments': {
      parameters: [P, T],
      post: op('Tasks', 'Comment on a task (mention people with @[Name](userId))', { requestBody: body({ type: 'object', properties: { text: { type: 'string' } } }) }),
    },
    '/time-entries': {
      get: op('Time', 'Time entries (your own, or a project’s with ?project=)', {
        parameters: [query('project', 'Project id', id), query('task', 'Task id', id), query('user', 'User id', id), query('from', 'From date', date), query('to', 'To date', date)],
        responses: { '200': json({ type: 'object', properties: { entries: { type: 'array', items: ref('TimeEntry') } } }), ...errors },
      }),
      post: op('Time', 'Log time', {
        requestBody: body({ type: 'object', required: ['project', 'date', 'hours'], properties: { project: id, task: { ...id, nullable: true }, activity: { ...id, nullable: true }, date, hours: { type: 'number' }, comment: { type: 'string' } } }),
      }),
    },
    '/time-entries/{entryId}': {
      parameters: [pathId('entryId', 'Time entry id')],
      patch: op('Time', 'Change a time entry', { requestBody: body({ type: 'object' }) }),
      delete: op('Time', 'Delete a time entry', { responses: { '204': { description: 'Deleted' }, ...errors } }),
    },
    '/projects/{id}/cost-entries': {
      parameters: [P],
      get: op('Costs', 'Cost entries'),
      post: op('Costs', 'Record a cost', {
        requestBody: body({ type: 'object', required: ['costType', 'units', 'date'], properties: { costType: id, units: { type: 'number' }, date, task: { ...id, nullable: true }, budget: { ...id, nullable: true }, comment: { type: 'string' } } }),
      }),
    },
    '/projects/{id}/budgets': {
      parameters: [P],
      get: op('Costs', 'Budgets with planned vs actual'),
      post: op('Costs', 'Create a budget', { requestBody: body({ type: 'object' }) }),
    },
    '/projects/{id}/reports': {
      parameters: [P],
      get: op('Reports', 'Time or cost totals', {
        parameters: [
          query('kind', 'time or cost', { enum: ['time', 'cost'] }),
          query('groupBy', 'Grouping', { enum: ['user', 'activity', 'task', 'month', 'week', 'costType', 'project'] }),
          query('from', 'From date', date),
          query('to', 'To date', date),
          query('includeSubprojects', 'Include sub-projects', { enum: ['true', 'false'] }),
        ],
      }),
    },
    '/users': { get: op('Users', 'Everyone in the organisation', { responses: { '200': json({ type: 'object', properties: { users: { type: 'array', items: ref('User') } } }), ...errors } }) },
    '/webhooks': {
      get: op('Webhooks', 'List webhooks (administrators)'),
      post: op('Webhooks', 'Create a webhook — the signing secret is returned once', {
        requestBody: body({ type: 'object', required: ['name', 'url'], properties: { name: { type: 'string' }, url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string', example: 'task.*' } }, project: { ...id, nullable: true } } }),
      }),
    },
  },
  webhooks: {
    change: {
      post: {
        summary: 'Sent for every matching change',
        description:
          'Headers: `X-PMS-Event` (e.g. task.updated), `X-PMS-Delivery` (unique id), `X-PMS-Signature: sha256=<HMAC-SHA256 of the raw body with your secret>`. Respond with 2xx within 10 seconds; failed deliveries are retried 3 times.',
        requestBody: body(ref('WebhookPayload')),
        responses: { '200': { description: 'Received' } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Personal access token (pms_…) or session token' } },
    responses: {
      BadRequest: json(ref('Error'), 'Invalid input'),
      Unauthorized: json(ref('Error'), 'Missing, invalid or expired token'),
      Forbidden: json(ref('Error'), 'Not allowed (e.g. read-only token or missing project permission)'),
      NotFound: json(ref('Error'), 'Not found or not visible to you'),
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' }, requestId: { type: 'string' } } } } },
      User: { type: 'object', properties: { _id: id, name: { type: 'string' }, email: { type: 'string' }, role: { enum: ['Admin', 'User'] }, isActive: { type: 'boolean' } } },
      Project: {
        type: 'object',
        properties: {
          _id: id,
          name: { type: 'string' },
          key: { type: 'string', example: 'COFO' },
          kind: { enum: ['project', 'program', 'portfolio'] },
          status: { enum: ['active', 'on_hold', 'completed', 'archived'] },
          startDate: date,
          finishDate: date,
          parent: { ...id, nullable: true },
          myRole: { type: 'string' },
          myPermissions: { type: 'array', items: { type: 'string' } },
        },
      },
      Task: {
        type: 'object',
        properties: {
          _id: id,
          number: { type: 'integer' },
          name: { type: 'string' },
          parent: { ...id, nullable: true },
          wbs: { type: 'string', example: '1.2' },
          start: date,
          finish: date,
          duration: { type: 'integer' },
          percentComplete: { type: 'number' },
          isSummary: { type: 'boolean' },
          isMilestone: { type: 'boolean' },
          isCritical: { type: 'boolean' },
          totalSlack: { type: 'integer' },
          assignee: { ...id, nullable: true },
          status: { ...id, nullable: true },
          work: { type: 'number', nullable: true },
          remainingWork: { type: 'number', nullable: true },
          spentHours: { type: 'number' },
        },
      },
      Plan: { type: 'object', properties: { project: ref('Project'), tasks: { type: 'array', items: ref('Task') } } },
      TimeEntry: {
        type: 'object',
        properties: { _id: id, project: id, task: { ...id, nullable: true }, user: { type: 'object' }, date, hours: { type: 'number' }, comment: { type: 'string' }, cost: { type: 'number', nullable: true } },
      },
      WebhookPayload: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', example: 'task.updated' },
          at: { type: 'string', format: 'date-time' },
          actor: { type: 'object', nullable: true, properties: { id, name: { type: 'string' } } },
          projectId: { ...id, nullable: true },
          entityId: { ...id, nullable: true },
          resource: { type: 'string', example: 'projects/tasks' },
          data: { type: 'object', nullable: true, description: 'Current snapshot of the task or project (null for deletions and other kinds)' },
        },
      },
    },
  },
}) as Json;
