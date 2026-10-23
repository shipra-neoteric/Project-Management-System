import { Router } from 'express';
import { accessFilter } from '../middleware/projectAccess';
import { Project } from '../models/Project';
import { Task } from '../models/Task';

export const searchRouter = Router();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** GET /api/search?q=… — projects and tasks the user can see. Matches names, notes and IDs like "OF-12". */
searchRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q.length < 2) return void res.json({ projects: [], tasks: [] });

  const accessible = await Project.find(accessFilter(req.user!)).select('name key status').lean();
  const byId = new Map(accessible.map((p) => [String(p._id), p]));
  const rx = new RegExp(escapeRegex(q), 'i');

  const projects = accessible.filter((p) => rx.test(p.name) || (p.key && rx.test(p.key))).slice(0, 5);

  const or: Record<string, unknown>[] = [{ name: rx }, { notes: rx }];
  const id = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(q);
  if (id) {
    const project = accessible.find((p) => p.key === id[1].toUpperCase());
    if (project) or.unshift({ project: project._id, number: Number(id[2]) });
  }
  const tasks = await Task.find({ project: { $in: accessible.map((p) => p._id) }, $or: or })
    .select('project name number start finish percentComplete isSummary isMilestone')
    .limit(20)
    .lean();

  res.json({
    projects,
    tasks: tasks.map((t) => {
      const p = byId.get(String(t.project));
      return { ...t, projectName: p?.name ?? '', projectKey: p?.key ?? '' };
    }),
  });
});
