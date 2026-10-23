import { Schema, model, type Types } from 'mongoose';
import { LINK_TYPES, type LinkType } from '../scheduling/scheduler';

const linkSchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: LINK_TYPES, default: 'FS' },
    lag: { type: Number, default: 0 },
  },
  { _id: false },
);

const taskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    parent: { type: Schema.Types.ObjectId, default: null },
    order: { type: Number, default: 0 },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    duration: { type: Number, default: 1, min: 0 },
    constraintStart: { type: String, default: null },
    percentComplete: { type: Number, default: 0, min: 0, max: 100 },
    predecessors: { type: [linkSchema], default: [] },
    resources: { type: [Schema.Types.ObjectId], default: [] },
    notes: { type: String, default: '', maxlength: 5000 },
    baselineStart: { type: String, default: null },
    baselineFinish: { type: String, default: null },
    // Computed by the scheduler
    start: { type: String, default: '' },
    finish: { type: String, default: '' },
    isSummary: { type: Boolean, default: false },
    isMilestone: { type: Boolean, default: false },
    isCritical: { type: Boolean, default: false },
    totalSlack: { type: Number, default: 0 },
    wbs: { type: String, default: '' },
    outlineLevel: { type: Number, default: 0 },
    rowNumber: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
taskSchema.index({ project: 1, rowNumber: 1 });

export const Task = model('Task', taskSchema);

/** Plain (lean) task object used by the plan service. */
export interface PlanTask {
  _id: Types.ObjectId;
  project: Types.ObjectId;
  parent: Types.ObjectId | null;
  order: number;
  name: string;
  duration: number;
  constraintStart: string | null;
  percentComplete: number;
  predecessors: { task: Types.ObjectId; type: LinkType; lag: number }[];
  resources: Types.ObjectId[];
  notes: string;
  baselineStart: string | null;
  baselineFinish: string | null;
  start: string;
  finish: string;
  isSummary: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  totalSlack: number;
  wbs: string;
  outlineLevel: number;
  rowNumber: number;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
