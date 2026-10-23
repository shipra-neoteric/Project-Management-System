import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const APP_ROLES = ['Admin', 'User'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: APP_ROLES, default: 'User' },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    notifyByEmail: { type: Boolean, default: true },
    // One-time tokens are stored as SHA-256 hashes, never in plain text.
    verifyTokenHash: { type: String, default: null, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },
    favorites: { type: [Schema.Types.ObjectId], ref: 'Project', default: [] },
    /** Ordered list of dashboard widget ids the user has switched on (null = defaults). */
    dashboardWidgets: { type: [String], default: undefined },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/** Shape returned to clients — never includes the password hash. */
export function publicUser(user: UserDoc) {
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role as AppRole,
    isActive: user.isActive,
    emailVerified: !!user.emailVerified,
    notifyByEmail: user.notifyByEmail !== false,
    favorites: (user.favorites ?? []).map(String),
    dashboardWidgets: user.dashboardWidgets ?? null,
  };
}
