import { Schema, model } from 'mongoose';

export const DEFAULT_SETTINGS = { orgName: 'Neoteric Properties', themeColor: '#f97316' };

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    orgName: { type: String, default: DEFAULT_SETTINGS.orgName, trim: true, maxlength: 80 },
    themeColor: { type: String, default: DEFAULT_SETTINGS.themeColor },
    /** ISO currency code used for rates, costs and budgets. */
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
    /**
     * Allowed status transitions per project role:
     * `{ manager: { "<fromStatusId>": ["<toStatusId>", …] }, member: {…} }`.
     * A role without an entry may change to any status. Owners/admins are never restricted.
     */
    workflow: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const Setting = model('Setting', settingSchema);
