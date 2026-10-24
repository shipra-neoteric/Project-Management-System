import { Router } from 'express';
import mongoose, { Types } from 'mongoose';
import multer from 'multer';
import { hasPerm, loadProject } from '../middleware/projectAccess';
import { Attachment } from '../models/Attachment';
import { Task, type PlanTask } from '../models/Task';
import { recordAttachment } from '../services/activity';
import { assertObjectId, badRequest, forbidden, HttpError, notFound } from '../utils/http';

/** Mounted at /api/projects/:id/tasks/:taskId/attachments. Files live in MongoDB GridFS (free on Atlas). */
export const attachmentsRouter = Router({ mergeParams: true });

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'attachments' });

async function loadTask(projectId: Types.ObjectId, taskId: unknown) {
  const task = await Task.findOne({ _id: assertObjectId(taskId, 'Task'), project: projectId }).lean<PlanTask>();
  if (!task) throw notFound('Task');
  return task;
}

/** Deletes stored files for the given attachment documents. */
export async function deleteAttachmentFiles(filter: Record<string, unknown>) {
  const docs = await Attachment.find(filter).select('fileId');
  for (const d of docs) await bucket().delete(d.fileId).catch(() => undefined);
  await Attachment.deleteMany(filter);
}

attachmentsRouter.get('/', loadProject('viewer'), async (req, res) => {
  const task = await loadTask(req.project!._id, req.params.taskId);
  const attachments = await Attachment.find({ task: task._id }).sort({ createdAt: -1 }).populate('uploadedBy', 'name').lean();
  res.json({ attachments });
});

attachmentsRouter.post(
  '/',
  loadProject('member'),
  (req, res, next) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'FILE_TOO_LARGE', 'Files can be at most 10 MB'));
      next(err);
    }),
  async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Choose a file to upload');
    const task = await loadTask(req.project!._id, req.params.taskId);
    const filename = file.originalname.replace(/[\\/\r\n]/g, '_').slice(0, 255) || 'file';
    const fileId = new Types.ObjectId();
    await new Promise<void>((resolve, reject) => {
      const stream = bucket().openUploadStreamWithId(fileId, filename, { metadata: { contentType: file.mimetype } });
      stream.on('error', reject).on('finish', () => resolve());
      stream.end(file.buffer);
    });
    const attachment = await Attachment.create({
      project: req.project!._id,
      task: task._id,
      fileId,
      filename,
      contentType: file.mimetype || 'application/octet-stream',
      size: file.size,
      uploadedBy: req.user!._id,
    });
    await recordAttachment(req.project!, req.user!, task, `Attached ${filename}`);
    res.status(201).json({ attachment: await Attachment.findById(attachment._id).populate('uploadedBy', 'name').lean() });
  },
);

attachmentsRouter.get('/:attachmentId', loadProject('viewer'), async (req, res) => {
  const attachment = await Attachment.findOne({ _id: assertObjectId(req.params.attachmentId, 'Attachment'), task: req.params.taskId, project: req.project!._id });
  if (!attachment) throw notFound('Attachment');
  // Always download (never render inline) so uploaded HTML/SVG can't run in our origin.
  res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.setHeader('Content-Length', String(attachment.size));
  bucket()
    .openDownloadStream(attachment.fileId)
    .on('error', () => res.destroy())
    .pipe(res);
});

attachmentsRouter.delete('/:attachmentId', loadProject('member'), async (req, res) => {
  const attachment = await Attachment.findOne({ _id: assertObjectId(req.params.attachmentId, 'Attachment'), task: req.params.taskId, project: req.project!._id });
  if (!attachment) throw notFound('Attachment');
  if (String(attachment.uploadedBy) !== req.user!._id.toString() && !hasPerm(req, 'manage_project')) {
    throw forbidden('Only the uploader or a manager can delete this file');
  }
  await deleteAttachmentFiles({ _id: attachment._id });
  const task = await loadTask(req.project!._id, req.params.taskId);
  await recordAttachment(req.project!, req.user!, task, `Removed ${attachment.filename}`);
  res.status(204).end();
});
