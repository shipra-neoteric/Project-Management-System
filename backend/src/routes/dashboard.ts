import { Router } from 'express';
import { accessFilter } from '../middleware/projectAccess';
import { Project } from '../models/Project';
import { Task } from '../models/Task';
import { addDays, todayISO } from '../scheduling/calendar';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const projects = await Project.find({ ...accessFilter(req.user!), status: { $ne: 'archived' } })
    .select('name')
    .lean();
  const projectIds = projects.map((p) => p._id);
  const names = new Map(projects.map((p) => [p._id.toString(), p.name]));
  const today = todayISO();

  const leaves = await Task.find({ project: { $in: projectIds }, isSummary: false })
    .select('project name start finish duration percentComplete isMilestone isCritical rowNumber')
    .lean();

  const withProject = <T extends { project: unknown }>(t: T) => ({ ...t, projectName: names.get(String(t.project)) ?? '' });
  const open = leaves.filter((t) => t.percentComplete < 100);
  const overdue = open.filter((t) => t.finish < today).sort((a, b) => a.finish.localeCompare(b.finish));
  const horizon = addDays(today, 30);
  const milestones = open
    .filter((t) => t.isMilestone && t.start >= today && t.start <= horizon)
    .sort((a, b) => a.start.localeCompare(b.start));

  const days = leaves.reduce((a, t) => a + t.duration, 0);
  const percentComplete = days > 0
    ? leaves.reduce((a, t) => a + t.percentComplete * t.duration, 0) / days
    : leaves.length ? leaves.reduce((a, t) => a + t.percentComplete, 0) / leaves.length : 0;

  res.json({
    kpis: {
      projects: projects.length,
      activeTasks: open.length,
      overdueTasks: overdue.length,
      percentComplete: Math.round(percentComplete),
    },
    upcomingMilestones: milestones.slice(0, 10).map(withProject),
    overdueTasks: overdue.slice(0, 10).map(withProject),
  });
});
