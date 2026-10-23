import { WorkCalendar } from './calendar';

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export const LINK_TYPES: LinkType[] = ['FS', 'SS', 'FF', 'SF'];

export interface SchedLink {
  task: string;
  type: LinkType;
  lag: number;
}

export interface SchedTaskInput {
  id: string;
  parent: string | null;
  order: number;
  name: string;
  duration: number;
  constraintStart: string | null;
  percentComplete: number;
  predecessors: SchedLink[];
}

export interface SchedProjectInput {
  startDate: string;
  workingDays: number[];
  holidays: string[];
}

export interface SchedTaskResult {
  start: string;
  finish: string;
  duration: number;
  percentComplete: number;
  isSummary: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  totalSlack: number;
  wbs: string;
  outlineLevel: number;
  rowNumber: number;
}

export interface ScheduleOutput {
  results: Map<string, SchedTaskResult>;
  finishDate: string;
  /** Duration-weighted completion of all leaf tasks (0–100). */
  percentComplete: number;
}

/** Thrown when the plan cannot be scheduled (cycles, unsupported links). */
export class ScheduleError extends Error {}

interface Outgoing {
  succ: string;
  type: LinkType;
  lag: number;
}

/**
 * Schedules a whole project. Pure function — see docs/06-SCHEDULING-ENGINE.md.
 */
export function schedule(project: SchedProjectInput, tasks: SchedTaskInput[]): ScheduleOutput {
  const cal = new WorkCalendar(project.startDate, project.workingDays, project.holidays);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // ---- 1. Outline tree (children sorted by order) ----------------------------------------
  const children = new Map<string | null, SchedTaskInput[]>();
  for (const t of tasks) {
    const parentKey = t.parent && byId.has(t.parent) && t.parent !== t.id ? t.parent : null;
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey)!.push(t);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);

  const parentOf = new Map<string, string | null>();
  const flat: SchedTaskInput[] = [];
  const wbs = new Map<string, string>();
  const level = new Map<string, number>();
  const walk = (parentKey: string | null, prefix: string, depth: number) => {
    (children.get(parentKey) ?? []).forEach((t, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      parentOf.set(t.id, parentKey);
      wbs.set(t.id, code);
      level.set(t.id, depth);
      flat.push(t);
      walk(t.id, code, depth + 1);
    });
  };
  walk(null, '', 0);
  if (flat.length !== tasks.length) throw new ScheduleError('The task outline contains a loop');

  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;
  const dur = new Map<string, number>();
  for (const t of tasks) dur.set(t.id, Math.max(0, Math.round(t.duration || 0)));

  // ---- 2. Dependency graph ------------------------------------------------------------------
  // Leaves are a single node "l:id"; summaries are split into an in-gate "i:id"
  // (start floor, before children) and an out-gate "o:id" (roll-up, after children).
  const inNode = (id: string) => (isSummary(id) ? `i:${id}` : `l:${id}`);
  const outNode = (id: string) => (isSummary(id) ? `o:${id}` : `l:${id}`);

  const nodes = new Set<string>();
  for (const t of tasks) {
    nodes.add(inNode(t.id));
    nodes.add(outNode(t.id));
  }
  const edges = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of nodes) {
    edges.set(n, []);
    indegree.set(n, 0);
  }
  const addEdge = (from: string, to: string) => {
    edges.get(from)!.push(to);
    indegree.set(to, indegree.get(to)! + 1);
  };

  const incoming = new Map<string, SchedLink[]>();
  const outgoing = new Map<string, Outgoing[]>();
  for (const t of tasks) {
    const seen = new Set<string>();
    const links: SchedLink[] = [];
    for (const link of t.predecessors ?? []) {
      if (!byId.has(link.task) || link.task === t.id || seen.has(link.task)) continue;
      seen.add(link.task);
      if (isSummary(t.id) && (link.type === 'FF' || link.type === 'SF')) {
        throw new ScheduleError(
          `"${t.name}" is a summary task: only Finish-to-Start or Start-to-Start links can point to it. Link the tasks inside it instead.`,
        );
      }
      const lag = Math.round(link.lag || 0);
      links.push({ task: link.task, type: link.type, lag });
      if (!outgoing.has(link.task)) outgoing.set(link.task, []);
      outgoing.get(link.task)!.push({ succ: t.id, type: link.type, lag });
      addEdge(outNode(link.task), inNode(t.id));
    }
    incoming.set(t.id, links);
    for (const child of children.get(t.id) ?? []) {
      addEdge(`i:${t.id}`, inNode(child.id));
      addEdge(outNode(child.id), `o:${t.id}`);
    }
  }

  // ---- 3. Topological order (Kahn) ----------------------------------------------------------
  const queue: string[] = [];
  for (const [n, d] of indegree) if (d === 0) queue.push(n);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of edges.get(n)!) {
      indegree.set(m, indegree.get(m)! - 1);
      if (indegree.get(m) === 0) queue.push(m);
    }
  }
  if (order.length !== nodes.size) {
    const stuck = new Set<string>();
    for (const [n, d] of indegree) if (d > 0) stuck.add(n.slice(2));
    const names = [...stuck].slice(0, 5).map((id) => `"${byId.get(id)?.name}"`);
    throw new ScheduleError(
      `Circular dependency: ${names.join(', ')}${stuck.size > 5 ? ' …' : ''}. A task cannot depend on itself, its summary task or its own successors.`,
    );
  }

  // ---- 4. Forward pass (earliest dates) -----------------------------------------------------
  const start = new Map<string, number>();
  const end = new Map<string, number>();
  const floor = new Map<string, number>(); // in-gate floors of summaries

  const constraintIndex = (t: SchedTaskInput) => (t.constraintStart ? cal.indexOf(t.constraintStart) : 0);
  const parentFloor = (id: string) => {
    const p = parentOf.get(id);
    return p ? floor.get(p)! : 0;
  };
  const linkFloor = (t: SchedTaskInput, d: number) => {
    let value = 0;
    for (const link of incoming.get(t.id)!) {
      const ps = start.get(link.task)!;
      const pe = end.get(link.task)!;
      let req: number;
      switch (link.type) {
        case 'FS': req = pe + link.lag; break;
        case 'SS': req = ps + link.lag; break;
        case 'FF': req = pe + link.lag - d; break;
        case 'SF': req = ps + link.lag - d; break;
      }
      value = Math.max(value, req);
    }
    return value;
  };

  for (const node of order) {
    const id = node.slice(2);
    const t = byId.get(id)!;
    if (node.startsWith('i:')) {
      floor.set(id, Math.max(parentFloor(id), constraintIndex(t), linkFloor(t, 0)));
    } else if (node.startsWith('l:')) {
      const d = dur.get(id)!;
      const s = Math.max(parentFloor(id), constraintIndex(t), linkFloor(t, d));
      start.set(id, s);
      end.set(id, s + d);
    } else {
      const kids = children.get(id)!;
      start.set(id, Math.min(...kids.map((k) => start.get(k.id)!)));
      end.set(id, Math.max(...kids.map((k) => end.get(k.id)!)));
    }
  }

  // ---- 5. Backward pass (latest dates → slack, critical path) -------------------------------
  const projectEnd = tasks.length ? Math.max(...tasks.map((t) => end.get(t.id)!)) : 0;
  const lateEnd = new Map<string, number>();
  const lateStart = new Map<string, number>(); // leaves: own; summaries: min of children (in-gate)

  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    const id = node.slice(2);
    if (node.startsWith('i:')) {
      const kids = children.get(id)!;
      lateStart.set(id, Math.min(...kids.map((k) => lateStart.get(k.id)!)));
      continue;
    }
    const d = end.get(id)! - start.get(id)!;
    const p = parentOf.get(id);
    let le = p ? Math.min(projectEnd, lateEnd.get(p)!) : projectEnd;
    for (const link of outgoing.get(id) ?? []) {
      const sLS = lateStart.get(link.succ)!;
      const sLE = lateEnd.get(link.succ)!;
      switch (link.type) {
        case 'FS': le = Math.min(le, sLS - link.lag); break;
        case 'SS': le = Math.min(le, sLS - link.lag + d); break;
        case 'FF': le = Math.min(le, sLE - link.lag); break;
        case 'SF': le = Math.min(le, sLE - link.lag + d); break;
      }
    }
    lateEnd.set(id, le);
    if (node.startsWith('l:')) lateStart.set(id, le - d);
  }

  // ---- 6. Roll-ups (bottom-up) and results --------------------------------------------------
  const results = new Map<string, SchedTaskResult>();
  const agg = new Map<string, { weighted: number; days: number; pctSum: number; count: number; slack: number; critical: boolean }>();

  for (let i = flat.length - 1; i >= 0; i--) {
    const t = flat[i];
    const s = start.get(t.id)!;
    const e = end.get(t.id)!;
    const summary = isSummary(t.id);
    let pct: number;
    let slack: number;
    let critical: boolean;

    if (summary) {
      const kids = children.get(t.id)!.map((k) => agg.get(k.id)!);
      const weighted = kids.reduce((a, k) => a + k.weighted, 0);
      const days = kids.reduce((a, k) => a + k.days, 0);
      const pctSum = kids.reduce((a, k) => a + k.pctSum, 0);
      const count = kids.reduce((a, k) => a + k.count, 0);
      pct = days > 0 ? weighted / days : count > 0 ? pctSum / count : 0;
      slack = Math.min(...kids.map((k) => k.slack));
      critical = kids.some((k) => k.critical);
      agg.set(t.id, { weighted, days, pctSum, count, slack, critical });
    } else {
      pct = Math.min(100, Math.max(0, t.percentComplete || 0));
      slack = lateStart.get(t.id)! - s;
      critical = slack <= 0;
      const d = e - s;
      agg.set(t.id, { weighted: pct * d, days: d, pctSum: pct, count: 1, slack, critical });
    }

    const d = e - s;
    results.set(t.id, {
      start: cal.dateAt(s),
      finish: d > 0 ? cal.dateAt(e - 1) : cal.dateAt(s),
      duration: d,
      percentComplete: Math.round(pct),
      isSummary: summary,
      isMilestone: !summary && d === 0,
      isCritical: critical,
      totalSlack: slack,
      wbs: wbs.get(t.id)!,
      outlineLevel: level.get(t.id)!,
      rowNumber: 0,
    });
  }
  flat.forEach((t, i) => (results.get(t.id)!.rowNumber = i + 1));

  const roots = children.get(null) ?? [];
  const rootAgg = roots.map((r) => agg.get(r.id)!);
  const totalDays = rootAgg.reduce((a, k) => a + k.days, 0);
  const totalCount = rootAgg.reduce((a, k) => a + k.count, 0);
  const percentComplete =
    totalDays > 0
      ? rootAgg.reduce((a, k) => a + k.weighted, 0) / totalDays
      : totalCount > 0
        ? rootAgg.reduce((a, k) => a + k.pctSum, 0) / totalCount
        : 0;

  let finishDate = project.startDate;
  for (const r of results.values()) if (r.finish > finishDate) finishDate = r.finish;

  return { results, finishDate, percentComplete: Math.round(percentComplete) };
}
