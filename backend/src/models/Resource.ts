import { Schema, model } from 'mongoose';

const resourceSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const Resource = model('Resource', resourceSchema);
