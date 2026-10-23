import { Schema, model } from 'mongoose';

/** A named snapshot of every task's planned dates, used to compare the plan against the past. */
const baselineSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    finishDate: { type: String, default: '' },
    tasks: {
      type: [{ _id: false, task: Schema.Types.ObjectId, start: String, finish: String }],
      default: [],
    },
  },
  { timestamps: true },
);

export const Baseline = model('Baseline', baselineSchema);
