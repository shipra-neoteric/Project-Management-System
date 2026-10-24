'use client';

import { Hammer, Package, Pencil, PiggyBank, Plus, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Alert, EmptyState, PageLoader } from '@/components/ui/Feedback';
import { Field, inputCls, Sec, textareaCls } from '@/components/ui/Field';
import { Card, KpiCard, KpiGrid } from '@/components/ui/Layout';
import { ThemedSelect } from '@/components/ui/ThemedSelect';
import { useWorkspace } from '@/features/project-context';
import { useBudgets, type BudgetInput } from '@/features/queries';
import { confirmDanger, toastError, toastSuccess } from '@/lib/alerts';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtHours, useMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Budget, BudgetSummary } from '@/lib/types';

const idOf = (v: { _id: string } | string | null | undefined) => (v && typeof v === 'object' ? v._id : (v ?? ''));

export default function BudgetsPage() {
  const { projectId, can, isLoading } = useWorkspace();
  const budgets = useBudgets(projectId, can('view_budgets'));
  const { money } = useMoney();
  const [drawer, setDrawer] = useState<{ open: boolean; budget: Budget | null }>({ open: false, budget: null });
  const canManage = can('manage_budgets');

  if (!can('view_budgets')) return <EmptyState icon={PiggyBank} title="No access to budgets" message="Your role in this project doesn’t include budgets." />;
  if (isLoading || budgets.isLoading) return <PageLoader />;
  if (budgets.error) return <Alert>{errorMessage(budgets.error)}</Alert>;
  const list = budgets.data?.budgets ?? [];
  const showMoney = !!budgets.data?.canSeeMoney;
  const totals = list.reduce(
    (a, b) => ({ planned: a.planned + (b.summary?.planned ?? 0), actual: a.actual + (b.summary?.actual ?? 0), hours: a.hours + (b.summary?.hours ?? 0) }),
    { planned: 0, actual: 0, hours: 0 },
  );

  const onDelete = async (b: Budget) => {
    if (!(await confirmDanger(`Delete "${b.name}"?`, 'Tasks and cost entries linked to it are kept but no longer counted against a budget.'))) return;
    try {
      await budgets.remove.mutateAsync(b._id);
      void toastSuccess('Budget deleted');
    } catch (err) {
      void toastError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">Planned labour and material costs. Time and costs on linked tasks count as actuals.</p>
        {canManage && (
          <Button variant="primary" icon={Plus} onClick={() => setDrawer({ open: true, budget: null })}>
            New budget
          </Button>
        )}
      </div>

      {showMoney && list.length > 0 && (
        <KpiGrid>
          <KpiCard label="Planned" value={money(totals.planned)} icon={PiggyBank} iconColor="text-blue-500" />
          <KpiCard label="Spent" value={money(totals.actual)} icon={Hammer} iconColor="text-amber-500" />
          <KpiCard label="Remaining" value={money(totals.planned - totals.actual)} icon={Package} iconColor={totals.actual > totals.planned ? 'text-red-500' : 'text-green-500'} />
          <KpiCard label="Hours spent" value={fmtHours(totals.hours)} icon={Users} iconColor="text-purple-500" />
        </KpiGrid>
      )}

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="No budgets yet"
            message="Create a budget, then link tasks to it from the task drawer."
            action={canManage ? <Button variant="primary" icon={Plus} onClick={() => setDrawer({ open: true, budget: null })}>New budget</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {list.map((b) => (
            <BudgetCard key={b._id} budget={b} showMoney={showMoney} canManage={canManage} onEdit={() => setDrawer({ open: true, budget: b })} onDelete={() => onDelete(b)} />
          ))}
        </div>
      )}

      {drawer.open && <BudgetDrawer budget={drawer.budget} onClose={() => setDrawer({ open: false, budget: null })} />}
    </div>
  );
}

function BudgetCard({ budget, showMoney, canManage, onEdit, onDelete }: { budget: Budget; showMoney: boolean; canManage: boolean; onEdit: () => void; onDelete: () => void }) {
  const { money } = useMoney();
  const s: BudgetSummary | undefined = budget.summary;
  const over = !!s && s.actual > s.planned;
  return (
    <Card
      title={budget.name}
      icon={PiggyBank}
      actions={
        canManage && (
          <div className="flex items-center gap-1">
            <IconButton icon={Pencil} label="Edit budget" tone="edit" onClick={onEdit} />
            <IconButton icon={Trash2} label="Delete budget" tone="delete" onClick={onDelete} />
          </div>
        )
      }
    >
      <div className="p-5 space-y-4">
        {budget.description && <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{budget.description}</p>}
        {s && showMoney ? (
          <>
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{money(s.actual)}</span> of {money(s.planned)}
                </span>
                <span className={cn('text-sm font-semibold tabular-nums', over ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200')}>{s.percentUsed}% used</span>
              </div>
              <UsageBar percent={s.percentUsed} />
              <p className={cn('text-xs mt-1.5', over ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400')}>
                {over ? `Over budget by ${money(s.actual - s.planned)}` : `${money(s.remaining)} remaining`}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {[
                ['Labour', s.actualLabor, s.plannedLabor, `${fmtHours(s.hours)} of ${fmtHours(s.plannedHours)}`],
                ['Material', s.actualMaterial, s.plannedMaterial, `${budget.material.length} planned item${budget.material.length === 1 ? '' : 's'}`],
              ].map(([label, actual, planned, note]) => (
                <div key={String(label)} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                  <dt className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</dt>
                  <dd className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums mt-1">
                    {money(actual as number)} <span className="font-normal text-gray-500 dark:text-gray-400">/ {money(planned as number)}</span>
                  </dd>
                  <dd className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{note}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : s ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {fmtHours(s.hours)} spent of {fmtHours(s.plannedHours)} planned · {s.percentUsed}% used
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** Spend vs. plan; turns red past 100 %. */
function UsageBar({ percent }: { percent: number }) {
  const { themeColor } = useTheme();
  const over = percent > 100;
  return (
    <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', over && 'bg-red-500')} style={{ width: `${Math.min(100, Math.max(0, percent))}%`, ...(over ? {} : { backgroundColor: themeColor }) }} />
    </div>
  );
}

interface LaborRow {
  label: string;
  user: string;
  hours: string;
  rate: string;
}
interface MaterialRow {
  costType: string;
  units: string;
  unitRate: string;
  comment: string;
}

function BudgetDrawer({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { projectId, ctx, workSettings } = useWorkspace();
  const { create, update } = useBudgets(projectId, false);
  const { money } = useMoney();
  const types = workSettings?.costTypes ?? [];
  const [name, setName] = useState(budget?.name ?? '');
  const [description, setDescription] = useState(budget?.description ?? '');
  const [labor, setLabor] = useState<LaborRow[]>(
    (budget?.labor ?? []).map((l) => ({ label: l.label, user: idOf(l.user), hours: String(l.hours), rate: String(l.rate) })),
  );
  const [material, setMaterial] = useState<MaterialRow[]>(
    (budget?.material ?? []).map((m) => ({ costType: idOf(m.costType), units: String(m.units), unitRate: String(m.unitRate), comment: m.comment })),
  );
  const [error, setError] = useState<string | null>(null);
  const people = [...(ctx?.people.values() ?? [])].map((p) => ({ value: p._id, label: p.name }));

  const num = (v: string) => Number(v) || 0;
  const laborTotal = labor.reduce((a, l) => a + num(l.hours) * num(l.rate), 0);
  const materialTotal = material.reduce((a, m) => a + num(m.units) * num(m.unitRate), 0);

  const setLaborRow = (i: number, patch: Partial<LaborRow>) => setLabor((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setMaterialRow = (i: number, patch: Partial<MaterialRow>) => setMaterial((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Name the budget');
    if (material.some((m) => !m.costType)) return setError('Choose a cost type in every material row, or remove the empty row');
    const body: BudgetInput = {
      name: name.trim(),
      description,
      labor: labor.map((l) => ({ label: l.label.trim(), user: l.user || null, hours: num(l.hours), rate: num(l.rate) })),
      material: material.map((m) => ({ costType: m.costType, units: num(m.units), unitRate: num(m.unitRate), comment: m.comment.trim() })),
    };
    try {
      if (budget) await update.mutateAsync({ id: budget._id, ...body });
      else await create.mutateAsync(body);
      void toastSuccess(budget ? 'Budget updated' : 'Budget created');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the budget'));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      icon={PiggyBank}
      width="lg"
      title={budget ? 'Edit budget' : 'New budget'}
      subtitle={`Planned total ${money(laborTotal + materialTotal)}`}
      footer={
        <>
          <Button inDrawer onClick={onClose}>
            Cancel
          </Button>
          <Button inDrawer variant="primary" loading={create.isPending || update.isPending} onClick={save}>
            {budget ? 'Save budget' : 'Create budget'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        {error && <Alert>{error}</Alert>}
        <section className="space-y-3">
          <Field label="Name" htmlFor="b-name" required>
            <input id="b-name" className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interiors – phase 1" />
          </Field>
          <Field label="Description" htmlFor="b-desc">
            <textarea id="b-desc" rows={3} className={textareaCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </section>

        <section>
          <Sec title={`Labour · ${money(laborTotal)}`} icon={Users} />
          <div className="space-y-3">
            {labor.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                <Field label="Description" className="col-span-12 sm:col-span-4">
                  <input className={inputCls} value={l.label} maxLength={80} onChange={(e) => setLaborRow(i, { label: e.target.value })} placeholder="e.g. Site supervisor" />
                </Field>
                <Field label="Person" className="col-span-12 sm:col-span-3">
                  <ThemedSelect options={[{ value: '', label: 'Anyone' }, ...people]} value={l.user} onChange={(v) => setLaborRow(i, { user: v })} searchable />
                </Field>
                <Field label="Hours" className="col-span-5 sm:col-span-2">
                  <input type="number" min={0} step="any" className={inputCls} value={l.hours} onChange={(e) => setLaborRow(i, { hours: e.target.value })} />
                </Field>
                <Field label="Rate / h" className="col-span-5 sm:col-span-2">
                  <input type="number" min={0} step="any" className={inputCls} value={l.rate} onChange={(e) => setLaborRow(i, { rate: e.target.value })} />
                </Field>
                <RemoveRow label="Remove labour row" onClick={() => setLabor((rows) => rows.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <Button inDrawer size="sm" icon={Plus} className="mt-3" onClick={() => setLabor((rows) => [...rows, { label: '', user: '', hours: '', rate: '' }])}>
            Add labour
          </Button>
        </section>

        <section>
          <Sec title={`Material & other costs · ${money(materialTotal)}`} icon={Package} />
          {!types.length && <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">No cost types yet. An administrator can add them under Work settings → Cost types.</p>}
          <div className="space-y-3">
            {material.map((m, i) => {
              const type = types.find((t) => t._id === m.costType);
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                  <Field label="Cost type" className="col-span-12 sm:col-span-4">
                    <ThemedSelect
                      options={types.map((t) => ({ value: t._id, label: t.name, description: `${money(t.unitRate)} per ${t.unit}` }))}
                      value={m.costType}
                      placeholder="Choose…"
                      onChange={(v) => setMaterialRow(i, { costType: v, unitRate: String(types.find((t) => t._id === v)?.unitRate ?? '') })}
                    />
                  </Field>
                  <Field label={`Units${type ? ` (${type.unit})` : ''}`} className="col-span-5 sm:col-span-2">
                    <input type="number" min={0} step="any" className={inputCls} value={m.units} onChange={(e) => setMaterialRow(i, { units: e.target.value })} />
                  </Field>
                  <Field label="Unit rate" className="col-span-5 sm:col-span-2">
                    <input type="number" min={0} step="any" className={inputCls} value={m.unitRate} onChange={(e) => setMaterialRow(i, { unitRate: e.target.value })} />
                  </Field>
                  <Field label="Note" className="col-span-12 sm:col-span-3 order-last sm:order-none">
                    <input className={inputCls} value={m.comment} maxLength={200} onChange={(e) => setMaterialRow(i, { comment: e.target.value })} />
                  </Field>
                  <RemoveRow label="Remove material row" onClick={() => setMaterial((rows) => rows.filter((_, j) => j !== i))} />
                </div>
              );
            })}
          </div>
          <Button
            inDrawer
            size="sm"
            icon={Plus}
            className="mt-3"
            disabled={!types.length}
            onClick={() => setMaterial((rows) => [...rows, { costType: types[0]?._id ?? '', units: '', unitRate: String(types[0]?.unitRate ?? ''), comment: '' }])}
          >
            Add material
          </Button>
        </section>

        <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Planned total</span>
          <span className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{money(laborTotal + materialTotal)}</span>
        </div>
      </div>
    </Drawer>
  );
}

function RemoveRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-2 sm:col-span-1 h-10 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      title={label}
      aria-label={label}
    >
      <X className="w-4 h-4" />
    </button>
  );
}
