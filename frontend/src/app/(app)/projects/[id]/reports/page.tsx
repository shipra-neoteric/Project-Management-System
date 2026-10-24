'use client';

import { BarChart3, Clock, Download, FileBarChart, Hash, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { inputCls } from '@/components/ui/Field';
import { Card, FilterTabs, KpiCard, KpiGrid, rowCls, tableCls, tbodyCls, td, th, theadCls } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useReport, type ReportParams } from '@/features/queries';
import { cn } from '@/lib/cn';
import { exportFileName, exportXlsx } from '@/lib/export';
import { fmtHours, useMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Report, ReportGroupBy, ReportKind } from '@/lib/types';

const GROUP_LABELS: Record<ReportGroupBy, string> = {
  user: 'Person',
  activity: 'Activity',
  costType: 'Cost type',
  task: 'Task',
  week: 'Week',
  month: 'Month',
  project: 'Project',
};
const GROUPS: Record<ReportKind, ReportGroupBy[]> = {
  time: ['user', 'activity', 'task', 'week', 'month', 'project'],
  cost: ['costType', 'user', 'task', 'week', 'month', 'project'],
};
const isPeriod = (g: ReportGroupBy) => g === 'week' || g === 'month';

export default function ReportsPage() {
  const { projectId, plan, can } = useWorkspace();
  const kinds = ([can('view_time') || can('log_time') ? 'time' : null, can('view_costs') ? 'cost' : null] as (ReportKind | null)[]).filter(Boolean) as ReportKind[];
  const [chosenKind, setKind] = useState<ReportKind>(kinds[0] ?? 'time');
  const kind = kinds.includes(chosenKind) ? chosenKind : (kinds[0] ?? 'time');
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('user');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeSubprojects, setIncludeSubprojects] = useState(true);
  const params: ReportParams = { kind, groupBy, from: from || undefined, to: to || undefined, includeSubprojects };
  const report = useReport(projectId, params, kinds.length > 0);
  const { money } = useMoney();
  const hasChildren = plan?.project.kind !== 'project';

  if (!kinds.length) return <EmptyState icon={FileBarChart} title="No access to reports" message="Your role in this project doesn’t include time or cost reports." />;

  const changeKind = (k: ReportKind) => {
    setKind(k);
    if (!GROUPS[k].includes(groupBy)) setGroupBy(GROUPS[k][0]);
  };
  const data = report.data;
  const showCost = data?.totals.cost !== null && data?.totals.cost !== undefined;
  const isTime = kind === 'time';

  const exportExcel = () => {
    if (!data) return;
    const header = [GROUP_LABELS[groupBy], ...(isTime ? ['Hours'] : ['Units']), ...(showCost ? ['Cost'] : []), 'Entries'];
    const rows = data.rows.map((r) => [r.label, isTime ? r.hours : r.units, ...(showCost ? [r.cost] : []), r.count]);
    rows.push(['Total', isTime ? data.totals.hours : null, ...(showCost ? [data.totals.cost] : []), data.totals.entries]);
    void exportXlsx(exportFileName(`${plan?.project.name ?? 'Project'} ${kind} report by ${GROUP_LABELS[groupBy].toLowerCase()}`, 'xlsx'), [
      { name: `${isTime ? 'Time' : 'Cost'} by ${GROUP_LABELS[groupBy]}`, header, rows, widths: [40, 12, 14, 10] },
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow px-3 py-2 flex flex-wrap items-center gap-2">
        {kinds.length > 1 && (
          <FilterTabs<ReportKind>
            value={kind}
            onChange={changeKind}
            tabs={[
              { key: 'time', label: 'Time', icon: Clock },
              { key: 'cost', label: 'Costs', icon: Wallet },
            ]}
          />
        )}
        <div className="w-44">
          <ThemedSelect compact options={GROUPS[kind].map((g) => ({ value: g, label: `By ${GROUP_LABELS[g].toLowerCase()}` }))} value={groupBy} onChange={(v) => setGroupBy(v as ReportGroupBy)} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          From
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          To
          <input type="date" className={`${inputCls} !h-8 !w-36`} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        {hasChildren && (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={includeSubprojects} onChange={(e) => setIncludeSubprojects(e.target.checked)} className="w-4 h-4 accent-[var(--theme-primary)]" />
            Include sub-projects
          </label>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={exportExcel}
            disabled={!data?.rows.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {report.error ? (
        <Alert>{(report.error as Error).message}</Alert>
      ) : report.isLoading || !data ? (
        <PageLoader />
      ) : (
        <>
          <KpiGrid>
            {isTime && <KpiCard label="Hours" value={fmtHours(data.totals.hours)} icon={Clock} iconColor="text-blue-500" />}
            {showCost && <KpiCard label={isTime ? 'Labour cost' : 'Cost'} value={money(data.totals.cost)} icon={Wallet} iconColor="text-green-500" />}
            <KpiCard label="Entries" value={data.totals.entries} icon={Hash} iconColor="text-amber-500" />
            <KpiCard label={data.projects === 1 ? 'Project' : 'Projects'} value={data.projects} icon={FileBarChart} iconColor="text-purple-500" />
          </KpiGrid>
          {data.rows.length === 0 ? (
            <Card>
              <EmptyState icon={BarChart3} title="Nothing to report" message={from || to ? 'No entries in this date range.' : `No ${isTime ? 'time' : 'costs'} recorded yet.`} />
            </Card>
          ) : (
            <ReportBody report={data} isTime={isTime} showCost={showCost} groupBy={groupBy} />
          )}
        </>
      )}
    </div>
  );
}

function ReportBody({ report, isTime, showCost, groupBy }: { report: Report; isTime: boolean; showCost: boolean; groupBy: ReportGroupBy }) {
  const { money } = useMoney();
  // Time reports can be charted by hours or by cost; cost reports always by cost.
  const [measure, setMeasure] = useState<'hours' | 'cost'>(isTime ? 'hours' : 'cost');
  const m = isTime ? measure : 'cost';
  const fmt = (v: number) => (m === 'hours' ? fmtHours(v) : money(v));
  const bars = useMemo(() => report.rows.map((r) => ({ key: r.key, label: r.label, value: (m === 'hours' ? r.hours : r.cost) ?? 0 })), [report.rows, m]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Card
        title={`${m === 'hours' ? 'Hours' : 'Cost'} by ${GROUP_LABELS[groupBy].toLowerCase()}`}
        icon={BarChart3}
        actions={
          isTime &&
          showCost && (
            <FilterTabs<'hours' | 'cost'>
              value={measure}
              onChange={setMeasure}
              tabs={[
                { key: 'hours', label: 'Hours' },
                { key: 'cost', label: 'Cost' },
              ]}
            />
          )
        }
      >
        <div className="p-5">
          <HBarChart rows={bars} format={fmt} keepOrder={isPeriod(groupBy)} />
        </div>
      </Card>
      <Card title="Details" icon={FileBarChart}>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>{GROUP_LABELS[groupBy]}</th>
                <th className={`${th} text-right`}>{isTime ? 'Hours' : 'Units'}</th>
                {showCost && <th className={`${th} text-right`}>Cost</th>}
                <th className={`${th} text-right`}>Entries</th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {report.rows.map((r) => (
                <tr key={r.key} className={rowCls}>
                  <td className={`${td} text-sm font-medium text-gray-900 dark:text-white`}>{r.label}</td>
                  <td className={`${td} text-sm text-right tabular-nums text-gray-700 dark:text-gray-300`}>{isTime ? fmtHours(r.hours) : r.units}</td>
                  {showCost && <td className={`${td} text-sm text-right tabular-nums text-gray-700 dark:text-gray-300`}>{money(r.cost)}</td>}
                  <td className={`${td} text-sm text-right tabular-nums text-gray-500 dark:text-gray-400`}>{r.count}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td className={`${td} text-sm font-semibold text-gray-900 dark:text-white`}>Total</td>
                <td className={`${td} text-sm text-right font-semibold tabular-nums text-gray-900 dark:text-white`}>{isTime ? fmtHours(report.totals.hours) : ''}</td>
                {showCost && <td className={`${td} text-sm text-right font-semibold tabular-nums text-gray-900 dark:text-white`}>{money(report.totals.cost)}</td>}
                <td className={`${td} text-sm text-right font-semibold tabular-nums text-gray-900 dark:text-white`}>{report.totals.entries}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const MAX_BARS = 12;

/**
 * Magnitude comparison (dataviz rules): one hue, thin horizontal bars with a 4px rounded data end
 * anchored at zero, value in text ink at the bar end, hover tooltip per bar. Long category lists
 * fold into "Other"; periods (weeks/months) keep their chronological order.
 */
function HBarChart({ rows, format, keepOrder }: { rows: { key: string; label: string; value: number }[]; format: (v: number) => string; keepOrder: boolean }) {
  const { themeColor } = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const shown = useMemo(() => {
    if (keepOrder) return rows;
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    if (sorted.length <= MAX_BARS) return sorted;
    const head = sorted.slice(0, MAX_BARS - 1);
    const rest = sorted.slice(MAX_BARS - 1);
    return [...head, { key: '__other', label: `Other (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0) }];
  }, [rows, keepOrder]);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const top = Math.max(0, ...shown.map((r) => r.value));
  if (!top) return <p className="text-sm text-gray-400 dark:text-gray-500">Nothing to chart.</p>;

  return (
    <ul className="space-y-1" role="list" aria-label="Bar chart">
      {shown.map((r) => {
        const pct = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <li
            key={r.key}
            className={cn('relative grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 py-1 px-1 -mx-1 rounded', hover === r.key && 'bg-gray-50 dark:bg-gray-700/40')}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
            aria-label={`${r.label}: ${format(r.value)} (${pct}%)`}
          >
            <span className="text-sm text-gray-700 dark:text-gray-200 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="h-3 block">
              <span
                className="block h-3 rounded-r-[4px] transition-[width]"
                style={{ width: `${Math.max(1, (r.value / top) * 100)}%`, backgroundColor: r.key === '__other' ? 'rgb(156 163 175)' : themeColor }}
              />
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums text-right min-w-16">{format(r.value)}</span>
            {hover === r.key && (
              <span className="absolute z-10 left-40 -top-8 pointer-events-none whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-700 text-white text-xs px-2 py-1 shadow-lg">
                {r.label} · {format(r.value)} · {pct}% of total
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
