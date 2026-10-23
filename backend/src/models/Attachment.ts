import { Schema, model } from 'mongoose';

/** Metadata for a file stored in MongoDB GridFS (bucket "attachments"). */
const attachmentSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    task: { type: Schema.Types.ObjectId, required: true, index: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const Attachment = model('Attachment', attachmentSchema);
