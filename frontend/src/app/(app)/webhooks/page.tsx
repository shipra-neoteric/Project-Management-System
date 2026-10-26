'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, History, KeyRound, Pencil, Plus, RotateCcw, Send, Trash2, Webhook as WebhookIcon, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls } from '@/components/ui/Field';
import { Card, KpiCard, KpiGrid, Page, PageHeader, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { AdminGate } from '@/features/AdminGate';
import { useProjects } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/dates';

interface WebhookRow {
  _id: string;
  name: string;
  url: string;
  events: string[];
  project: { _id: string; name: string; key: string } | null;
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string;
  lastDeliveryAt: string | null;
}

interface Delivery {
  _id: string;
  deliveryId: string;
  eventType: string;
  payload: string;
  ok: boolean;
  status: number;
  attempts: number;
  durationMs: number;
  response: string;
  error: string;
  createdAt: string;
}

const KEY = ['webhooks'] as const;

const EVENT_LABELS: Record<string, string> = {
  '*': 'Everything',
  'project.*': 'Projects',
  'task.*': 'Tasks',
  'comment.*': 'Comments',
  'attachment.*': 'Files',
  'time-entry.*': 'Time entries',
  'cost-entry.*': 'Cost entries',
  'budget.*': 'Budgets',
  'member.*': 'Members',
  'meeting.*': 'Meetings',
  'baseline.*': 'Baselines',
};

function useWebhooks() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => api<{ webhooks: WebhookRow[]; events: string[] }>('/webhooks') });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  type Input = { name: string; url: string; events: string[]; project: string | null; active?: boolean };
  return {
    ...query,
    create: useMutation({ mutationFn: (body: Input) => api<{ webhook: WebhookRow; secret: string }>('/webhooks', { method: 'POST', body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<Input> & { id: string }) => api('/webhooks/' + id, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/webhooks/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
    test: useMutation({ mutationFn: (id: string) => api<{ delivery: Delivery }>(`/webhooks/${id}/test`, { method: 'POST' }), onSuccess: refresh }),
    rotate: useMutation({ mutationFn: (id: string) => api<{ secret: string }>(`/webhooks/${id}/rotate-secret`, { method: 'POST' }) }),
  };
}

export default function WebhooksPage() {
  return (
    <AdminGate>
      <WebhooksContent />
    </AdminGate>
  );
}

function WebhooksContent() {
  const hooks = useWebhooks();
  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [history, setHistory] = useState<WebhookRow | null>(null);
  const list = hooks.data?.webhooks ?? [];

  const runTest = (h: WebhookRow) =>
    hooks.test.mutate(h._id, {
      onSuccess: ({ delivery }) =>
        delivery.ok ? void toastSuccess(`Test delivered (HTTP ${delivery.status})`) : void toastError(`Test failed: ${delivery.error || `HTTP ${delivery.status}`}`),
      onError: (err) => void toastError(errorMessage(err)),
    });

  const remove = async (h: WebhookRow) => {
    if (!(await confirmDanger(`Delete “${h.name}”?`, 'It stops receiving events and its delivery history is removed.'))) return;
    hooks.remove.mutate(h._id, { onSuccess: () => void toastSuccess('Webhook deleted'), onError: (err) => void toastError(errorMessage(err)) });
  };

  const toggle = (h: WebhookRow) =>
    hooks.update.mutate({ id: h._id, active: !h.active }, { onSuccess: () => void toastSuccess(h.active ? 'Webhook paused' : 'Webhook turned on'), onError: (err) => void toastError(errorMessage(err)) });

  const rotate = async (h: WebhookRow) => {
    if (!(await confirmDanger(`New secret for “${h.name}”?`, 'The receiver must switch to the new secret, or it will reject our signatures.', 'Create new secret'))) return;
    hooks.rotate.mutate(h._id, { onSuccess: (d) => setSecret(d.secret), onError: (err) => void toastError(errorMessage(err)) });
  };

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        subtitle="Send project changes to other systems (ERP, BI, chat) as they happen. Each request is signed so the receiver can trust it."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            New webhook
          </Button>
        }
      />
      <KpiGrid>
        <KpiCard label="Webhooks" value={list.length} icon={WebhookIcon} iconColor="text-blue-500" />
        <KpiCard label="Active" value={list.filter((h) => h.active).length} icon={CheckCircle2} iconColor="text-green-500" />
        <KpiCard label="Failing" value={list.filter((h) => h.active && h.consecutiveFailures > 0).length} icon={AlertTriangle} iconColor="text-amber-500" />
        <KpiCard label="Turned off" value={list.filter((h) => !h.active).length} icon={XCircle} iconColor="text-red-500" />
      </KpiGrid>

      <Card>
        {hooks.isLoading ? (
          <PageLoader />
        ) : hooks.error ? (
          <Alert className="m-4">{errorMessage(hooks.error)}</Alert>
        ) : !list.length ? (
          <EmptyState
            icon={WebhookIcon}
            title="No webhooks yet"
            message="Add a URL and choose which changes to send. We POST a signed JSON message for each change."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
                New webhook
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Name</th>
                  <th className={`${th} hidden md:table-cell`}>Events</th>
                  <th className={th}>Status</th>
                  <th className={`${th} hidden lg:table-cell`}>Last delivery</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className={tbodyCls}>
                {list.map((h) => (
                  <tr key={h._id} className={rowCls}>
                    <td className={td}>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{h.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-xs" title={h.url}>
                        {h.url}
                      </p>
                      {h.project && <p className="text-xs text-gray-500 dark:text-gray-400">Only {h.project.name}</p>}
                    </td>
                    <td className={`${td} hidden md:table-cell`}>
                      <div className="flex flex-wrap gap-1">
                        {h.events.map((e) => (
                          <Badge key={e} tone="neutral">
                            {EVENT_LABELS[e] ?? e}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={td}>
                      {!h.active ? (
                        <span title={h.disabledReason || undefined}>
                          <Badge tone="danger" dot>
                            {h.disabledReason ? 'Turned off (failures)' : 'Paused'}
                          </Badge>
                        </span>
                      ) : h.consecutiveFailures > 0 ? (
                        <Badge tone="warning" dot>
                          Failing ×{h.consecutiveFailures}
                        </Badge>
                      ) : (
                        <Badge tone="success" dot>
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className={`${td} hidden lg:table-cell text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap`}>{h.lastDeliveryAt ? fmtDateTime(h.lastDeliveryAt) : '—'}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton icon={Send} label="Send test" onClick={() => runTest(h)} disabled={hooks.test.isPending} />
                        <IconButton icon={History} label="Delivery history" onClick={() => setHistory(h)} />
                        <IconButton icon={KeyRound} label="New signing secret" onClick={() => void rotate(h)} />
                        <IconButton icon={Pencil} tone="edit" label="Edit" onClick={() => setEditing(h)} />
                        <IconButton icon={Trash2} tone="delete" label="Delete" onClick={() => void remove(h)} />
                      </div>
                      <button type="button" onClick={() => toggle(h)} className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        {h.active ? 'Pause' : 'Turn on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Verifying requests" icon={KeyRound}>
        <div className="p-5 text-sm text-gray-600 dark:text-gray-300 space-y-2">
          <p>
            Every request carries <code className="font-mono text-xs">X-PMS-Signature: sha256=…</code> — an HMAC-SHA256 of the raw body using the webhook’s secret — plus{' '}
            <code className="font-mono text-xs">X-PMS-Event</code> and a unique <code className="font-mono text-xs">X-PMS-Delivery</code> id. Reply with any 2xx status within 10 seconds; failures are
            retried three times, and a webhook that fails 20 times in a row is turned off.
          </p>
          <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 overflow-x-auto text-gray-800 dark:text-gray-200">
            {`// Node.js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-pms-signature']));`}
          </pre>
        </div>
      </Card>

      <WebhookDrawer
        open={!!editing}
        hook={editing === 'new' ? null : editing}
        events={hooks.data?.events ?? Object.keys(EVENT_LABELS)}
        onClose={() => setEditing(null)}
        onCreated={(s) => {
          setEditing(null);
          setSecret(s);
        }}
      />
      <SecretDrawer secret={secret} onClose={() => setSecret(null)} />
      <HistoryDrawer hook={history} onClose={() => setHistory(null)} />
    </Page>
  );
}

function WebhookDrawer({ open, hook, events, onClose, onCreated }: { open: boolean; hook: WebhookRow | null; events: string[]; onClose: () => void; onCreated: (secret: string) => void }) {
  const { create, update } = useWebhooks();
  const projects = useProjects();
  const [form, setForm] = useState({ name: '', url: '', events: ['*'], project: '' });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? (hook?._id ?? 'new') : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (key) setForm(hook ? { name: hook.name, url: hook.url, events: hook.events, project: hook.project?._id ?? '' } : { name: '', url: 'https://', events: ['*'], project: '' });
  }
  const all = form.events.includes('*');
  const toggleEvent = (e: string) =>
    setForm((f) => {
      if (e === '*') return { ...f, events: ['*'] };
      const rest = f.events.filter((x) => x !== '*');
      const next = rest.includes(e) ? rest.filter((x) => x !== e) : [...rest, e];
      return { ...f, events: next.length ? next : ['*'] };
    });
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const save = () => {
    const body = { name: form.name.trim(), url: form.url.trim(), events: form.events, project: form.project || null };
    if (hook) update.mutate({ id: hook._id, ...body }, { onSuccess: () => (toastSuccess('Webhook saved'), onClose()) });
    else create.mutate(body, { onSuccess: (d) => onCreated(d.secret) });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={hook ? 'Edit webhook' : 'New webhook'}
      subtitle="Where to send changes, and which ones"
      icon={WebhookIcon}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={busy} disabled={!form.name.trim() || !/^https?:\/\/.+/.test(form.url.trim())} onClick={save}>
            {hook ? 'Save' : 'Create webhook'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{errorMessage(error)}</Alert>}
        <Field label="Name" htmlFor="wh-name" required>
          <input id="wh-name" className={inputCls} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nexora ERP sync" />
        </Field>
        <Field label="Payload URL" htmlFor="wh-url" required hint="Must use https://">
          <input id="wh-url" className={`${inputCls} font-mono text-xs`} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        </Field>
        <Field label="Project">
          <ThemedSelect
            searchable
            value={form.project}
            onChange={(v) => setForm({ ...form, project: v })}
            options={[{ value: '', label: 'All projects' }, ...(projects.data ?? []).filter((p) => !p.isTemplate).map((p) => ({ value: p._id, label: p.name, description: p.key }))]}
          />
        </Field>
        <fieldset>
          <legend className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Events</legend>
          <div className="grid grid-cols-2 gap-2">
            {events.map((e) => {
              const checked = e === '*' ? all : !all && form.events.includes(e);
              return (
                <label
                  key={e}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors',
                    checked ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-gray-900 dark:text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300',
                  )}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleEvent(e)} className="rounded" />
                  {EVENT_LABELS[e] ?? e}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Drawer>
  );
}

function SecretDrawer({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!secret}
      onClose={onClose}
      title="Signing secret"
      subtitle="Copy it now — it will not be shown again"
      icon={KeyRound}
      width="md"
      footer={
        <>
          <Button inDrawer icon={Copy} onClick={() => void navigator.clipboard.writeText(secret ?? '').then(() => toastSuccess('Secret copied'))}>
            Copy
          </Button>
          <Button inDrawer variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">Give this secret to the receiving system so it can verify the X-PMS-Signature header.</Alert>
        <input readOnly className={`${inputCls} font-mono text-xs`} value={secret ?? ''} aria-label="Signing secret" onFocus={(e) => e.target.select()} />
      </div>
    </Drawer>
  );
}

function HistoryDrawer({ hook, onClose }: { hook: WebhookRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', hook?._id],
    queryFn: async () => (await api<{ deliveries: Delivery[] }>(`/webhooks/${hook!._id}/deliveries`)).deliveries,
    enabled: !!hook,
  });
  const redeliver = useMutation({
    mutationFn: (d: Delivery) => api<{ delivery: Delivery }>(`/webhooks/${hook!._id}/deliveries/${d._id}/redeliver`, { method: 'POST' }),
    onSuccess: ({ delivery }) => {
      void qc.invalidateQueries({ queryKey: ['webhook-deliveries', hook?._id] });
      void qc.invalidateQueries({ queryKey: KEY });
      if (delivery.ok) void toastSuccess('Redelivered');
      else void toastError(`Redelivery failed: ${delivery.error || `HTTP ${delivery.status}`}`);
    },
    onError: (err) => void toastError(errorMessage(err)),
  });
  const pretty = (s: string) => {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };

  return (
    <Drawer open={!!hook} onClose={onClose} title="Delivery history" subtitle={hook ? `${hook.name} · last 50 deliveries` : ''} icon={History} width="lg">
      {deliveries.isLoading ? (
        <PageLoader />
      ) : !deliveries.data?.length ? (
        <EmptyState compact icon={History} title="Nothing sent yet" message="Use “Send test” or make a change in a project." />
      ) : (
        <ul className="space-y-2">
          {deliveries.data.map((d) => (
            <li key={d._id} className="rounded-lg border border-gray-200 dark:border-gray-700">
              <button type="button" onClick={() => setOpen(open === d._id ? null : d._id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                {d.ok ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <span className="font-mono text-xs text-gray-900 dark:text-white">{d.eventType}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto whitespace-nowrap">
                  {d.status ? `HTTP ${d.status}` : 'No response'} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'} · {d.durationMs} ms · {fmtDateTime(d.createdAt)}
                </span>
              </button>
              {open === d._id && (
                <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-3">
                  {d.error && <Alert>{d.error}</Alert>}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Payload</p>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-900 rounded-md p-3 overflow-x-auto max-h-64 text-gray-800 dark:text-gray-200">{pretty(d.payload)}</pre>
                  </div>
                  {d.response && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Response</p>
                      <pre className="text-xs bg-gray-50 dark:bg-gray-900 rounded-md p-3 overflow-x-auto max-h-40 text-gray-800 dark:text-gray-200">{d.response}</pre>
                    </div>
                  )}
                  <Button size="sm" icon={RotateCcw} loading={redeliver.isPending} onClick={() => redeliver.mutate(d)}>
                    Redeliver
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
