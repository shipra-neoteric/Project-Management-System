'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ChevronRight, Copy, KeyRound, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, PageLoader } from '@/components/ui/Feedback';
import { Card, Page, PageHeader, SearchInput } from '@/components/ui/Layout';
import { toastSuccess } from '@/lib/alerts';
import { API_URL, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
  required?: string[];
  description?: string;
  example?: unknown;
  format?: string;
  $ref?: string;
  anyOf?: Schema[];
  allOf?: Schema[];
};
interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}
interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: { 'application/json'?: { schema?: Schema } } };
  responses?: Record<string, { description?: string }>;
}
interface OpenApiDoc {
  info: { title: string; version: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation | Parameter[]>>;
  webhooks?: Record<string, { post?: Operation & { description?: string } }>;
  components?: { schemas?: Record<string, Schema> };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const METHOD_STYLE: Record<string, string> = {
  get: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  post: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  put: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  patch: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

/** Short, readable type name for a schema. */
function typeName(s: Schema | undefined, doc: OpenApiDoc): string {
  if (!s) return 'any';
  if (s.$ref) return s.$ref.split('/').pop()!;
  if (s.anyOf) return s.anyOf.map((x) => typeName(x, doc)).join(' | ');
  if (s.allOf) return s.allOf.map((x) => typeName(x, doc)).join(' & ');
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
  if (t === 'array') return `${typeName(s.items, doc)}[]`;
  return `${t ?? 'object'}${s.format ? ` (${s.format})` : ''}`;
}

/** Example JSON value built from a schema (examples, enums, formats). */
function example(s: Schema | undefined, doc: OpenApiDoc, depth = 0): unknown {
  if (!s || depth > 4) return null;
  if (s.$ref) return example(doc.components?.schemas?.[s.$ref.split('/').pop()!], doc, depth + 1);
  if (s.example !== undefined) return s.example;
  if (s.anyOf) return example(s.anyOf[0], doc, depth + 1);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => example(x, doc, depth + 1) as object));
  if (s.enum) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === 'string') return s.format === 'date' ? '2026-11-02' : s.format === 'date-time' ? '2026-11-02T09:00:00Z' : 'string';
  if (t === 'number' || t === 'integer') return 1;
  if (t === 'boolean') return true;
  if (t === 'array') return [example(s.items, doc, depth + 1)];
  if (s.properties) return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(v, doc, depth + 1)]));
  return {};
}

function curl(method: string, path: string, body: unknown) {
  const lines = [`curl -X ${method.toUpperCase()} "${API_URL}${path}"`, `  -H "Authorization: Bearer pms_YOUR_TOKEN"`];
  if (body !== undefined) lines.push(`  -H "Content-Type: application/json"`, `  -d '${JSON.stringify(body)}'`);
  return lines.join(' \\\n');
}

export default function ApiDocsPage() {
  const docQuery = useQuery({ queryKey: ['openapi'], queryFn: () => api<OpenApiDoc>('/openapi.json'), staleTime: Infinity });
  const [search, setSearch] = useState('');
  const doc = docQuery.data;

  const groups = useMemo(() => {
    if (!doc) return [];
    const ops: { tag: string; method: string; path: string; op: Operation; params: Parameter[] }[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      const shared = (item.parameters as Parameter[] | undefined) ?? [];
      for (const m of METHODS) {
        const op = item[m] as Operation | undefined;
        if (!op) continue;
        ops.push({ tag: op.tags?.[0] ?? 'Other', method: m, path, op, params: [...shared, ...(op.parameters ?? [])] });
      }
    }
    const q = search.trim().toLowerCase();
    const shown = q ? ops.filter((o) => `${o.method} ${o.path} ${o.op.summary ?? ''} ${o.tag}`.toLowerCase().includes(q)) : ops;
    return (doc.tags ?? []).map((t) => ({ ...t, ops: shown.filter((o) => o.tag === t.name) })).filter((g) => g.ops.length);
  }, [doc, search]);

  return (
    <Page>
      <PageHeader
        title="API documentation"
        subtitle="Connect other systems, scripts and reports to the Project Management System."
        actions={
          <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
            OpenAPI JSON
          </a>
        }
      />
      {docQuery.isLoading ? (
        <PageLoader />
      ) : docQuery.error || !doc ? (
        <Alert>{errorMessage(docQuery.error, 'Could not load the API description')}</Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Card title="Authentication" icon={KeyRound}>
              <div className="p-5 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <p>
                  Create a personal access token under{' '}
                  <Link href="/profile" className="text-blue-600 dark:text-blue-400 hover:underline">
                    My profile → API tokens
                  </Link>{' '}
                  and send it as a Bearer token. Read-only tokens can only make GET requests. Requests act as you, with your project permissions.
                </p>
                <CodeBlock text={curl('get', '/projects', undefined)} />
                <p>
                  Errors return JSON: <code className="font-mono text-xs">{'{ "error": { "message", "code", "requestId" } }'}</code> with status 400, 401, 403, 404 or 429.
                </p>
              </div>
            </Card>
            <Card title="Webhooks" icon={Webhook}>
              <div className="p-5 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <p>{doc.webhooks?.change?.post?.description}</p>
                <CodeBlock text={JSON.stringify(example(doc.components?.schemas?.WebhookPayload, doc), null, 2)} />
              </div>
            </Card>
          </div>

          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search endpoints…" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {doc.info.title} · v{doc.info.version}
            </span>
          </div>

          {groups.map((g) => (
            <Card key={g.name} title={g.name} icon={BookOpen}>
              {g.description && <p className="px-5 pt-3 text-sm text-gray-500 dark:text-gray-400">{g.description}</p>}
              <ul className="p-3 space-y-2">
                {g.ops.map((o) => (
                  <Endpoint key={`${o.method} ${o.path}`} method={o.method} path={o.path} op={o.op} params={o.params} doc={doc} />
                ))}
              </ul>
            </Card>
          ))}
          {!groups.length && <p className="text-sm text-gray-500 dark:text-gray-400">No endpoints match “{search}”.</p>}
        </>
      )}
    </Page>
  );
}

function Endpoint({ method, path, op, params, doc }: { method: string; path: string; op: Operation; params: Parameter[]; doc: OpenApiDoc }) {
  const [open, setOpen] = useState(false);
  const schema = op.requestBody?.content?.['application/json']?.schema;
  const body = schema ? example(schema, doc) : undefined;
  const props = schema?.properties ?? (schema?.$ref ? doc.components?.schemas?.[schema.$ref.split('/').pop()!]?.properties : undefined);
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left" aria-expanded={open}>
        <span className={cn('w-16 text-center text-[11px] font-bold uppercase rounded px-1.5 py-0.5', METHOD_STYLE[method])}>{method}</span>
        <code className="font-mono text-sm text-gray-900 dark:text-white break-all">{path}</code>
        <span className="hidden sm:block text-sm text-gray-500 dark:text-gray-400 truncate ml-2 flex-1">{op.summary}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 sm:hidden">{op.summary}</p>
          {params.length > 0 && (
            <Section title="Parameters">
              <FieldTable rows={params.map((p) => ({ name: p.name, where: p.in, type: typeName(p.schema, doc), required: !!p.required, description: p.description ?? '' }))} />
            </Section>
          )}
          {props && (
            <Section title="Request body">
              <FieldTable rows={Object.entries(props).map(([name, s]) => ({ name, where: 'body', type: typeName(s, doc), required: !!schema?.required?.includes(name), description: s.description ?? '' }))} />
            </Section>
          )}
          {op.responses && (
            <Section title="Responses">
              <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-0.5">
                {Object.entries(op.responses).map(([code, r]) => (
                  <li key={code}>
                    <span className="font-mono text-xs mr-2">{code}</span>
                    {r.description ?? ''}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Example">
            <CodeBlock text={curl(method, path, body)} />
          </Section>
        </div>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function FieldTable({ rows }: { rows: { name: string; where: string; type: string; required: boolean; description: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <tr key={`${r.where}-${r.name}`}>
              <td className="py-1.5 pr-3 font-mono text-xs text-gray-900 dark:text-white whitespace-nowrap">
                {r.name}
                {r.required && <span className="text-red-500">*</span>}
              </td>
              <td className="py-1.5 pr-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.where}</td>
              <td className="py-1.5 pr-3 font-mono text-xs text-purple-700 dark:text-purple-300">{r.type}</td>
              <td className="py-1.5 text-xs text-gray-600 dark:text-gray-300">{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="relative group">
      <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 pr-10 overflow-x-auto text-gray-800 dark:text-gray-200">{text}</pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(text).then(() => toastSuccess('Copied'))}
        className="absolute top-2 right-2 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        aria-label="Copy"
        title="Copy"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
