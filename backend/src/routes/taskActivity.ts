import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { hasPerm, loadProject } from '../middleware/projectAccess';
import { Journal } from '../models/Journal';
import { Task, type PlanTask } from '../models/Task';
import { parseMentions, recordComment } from '../services/activity';
import { assertObjectId, forbidden, notFound, parseBody } from '../utils/http';

/** Mounted at /api/projects/:id/tasks/:taskId — history, comments and watching. */
export const taskActivityRouter = Router({ mergeParams: true });

const commentSchema = z.object({ text: z.string().trim().min(1, 'Write a comment first').max(10_000) });

async function loadTask(projectId: Types.ObjectId, taskId: unknown) {
  const task = await Task.findOne({ _id: assertObjectId(taskId, 'Task'), project: projectId }).lean<PlanTask>();
  if (!task) throw notFound('Task');
  return task;
}

/** Journal entries with the author's name, oldest first. */
export async function journalsFor(filter: Record<string, unknown>, options: { limit?: number; before?: Date; newestFirst?: boolean } = {}) {
  const query = Journal.find({ ...filter, ...(options.before ? { createdAt: { $lt: options.before } } : {}) })
    .sort({ createdAt: options.newestFirst ? -1 : 1 })
    .populate('user', 'name email');
  if (options.limit) query.limit(options.limit);
  return query.lean();
}

taskActivityRouter.get('/activity', loadProject('viewer'), async (req, res) => {
  const task = await loadTask(req.project!._id, req.params.taskId);
  res.json({ activity: await journalsFor({ task: task._id }), watchers: task.watchers ?? [] });
});

taskActivityRouter.post('/comments', loadProject('comment'), async (req, res) => {
  const { text } = parseBody(commentSchema, req.body);
  const task = await loadTask(req.project!._id, req.params.taskId);
  // Commenters watch the task from now on.
  await Task.updateOne({ _id: task._id }, { $addToSet: { watchers: req.user!._id } });
  const journal = await recordComment(req.project!, req.user!, task, text);
  res.status(201).json({ journal: await Journal.findById(journal._id).populate('user', 'name email').lean() });
});

taskActivityRouter.patch('/comments/:journalId', loadProject('comment'), async (req, res) => {
  const { text } = parseBody(commentSchema, req.body);
  const journal = await Journal.findOne({ _id: assertObjectId(req.params.journalId, 'Comment'), task: req.params.taskId, kind: 'comment' });
  if (!journal) throw notFound('Comment');
  if (String(journal.user) !== req.user!._id.toString()) throw forbidden('You can only edit your own comments');
  journal.text = text;
  journal.mentions = parseMentions(text) as never;
  journal.editedAt = new Date();
  await journal.save();
  res.json({ journal: await Journal.findById(journal._id).populate('user', 'name email').lean() });
});

taskActivityRouter.delete('/comments/:journalId', loadProject('comment'), async (req, res) => {
  const journal = await Journal.findOne({ _id: assertObjectId(req.params.journalId, 'Comment'), task: req.params.taskId, kind: 'comment' });
  if (!journal) throw notFound('Comment');
  const own = String(journal.user) === req.user!._id.toString();
  if (!own && !hasPerm(req, 'manage_project')) throw forbidden('Only the author or a manager can delete this comment');
  await journal.deleteOne();
  res.status(204).end();
});

taskActivityRouter.post('/watch', loadProject('viewer'), async (req, res) => {
  const task = await loadTask(req.project!._id, req.params.taskId);
  await Task.updateOne({ _id: task._id }, { $addToSet: { watchers: req.user!._id } });
  res.json({ watching: true });
});

taskActivityRouter.delete('/watch', loadProject('viewer'), async (req, res) => {
  const task = await loadTask(req.project!._id, req.params.taskId);
  await Task.updateOne({ _id: task._id }, { $pull: { watchers: req.user!._id } });
  res.json({ watching: false });
});
