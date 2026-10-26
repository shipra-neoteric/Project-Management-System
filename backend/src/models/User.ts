import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const APP_ROLES = ['Admin', 'User'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Placeholder users have no email and cannot sign in. */
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    /** 'user' = real person; 'placeholder' = stand-in for someone not yet hired/named (e.g. "Electrician"). */
    kind: { type: String, enum: ['user', 'placeholder'], default: 'user' },
    /** Invited by email but has not set a password yet. */
    invited: { type: Boolean, default: false },
    inviteTokenHash: { type: String, default: null, select: false },
    globalRoles: { type: [Schema.Types.ObjectId], ref: 'GlobalRole', default: [] },
    workSchedule: {
      hoursPerDay: { type: Number, default: 8, min: 0, max: 24 },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    },
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
    /** Date reminders: alert N days before start/finish (0 = off), overdue alerts, daily email digest. */
    reminders: {
      dueSoonDays: { type: Number, default: 1, min: 0, max: 14 },
      overdue: { type: Boolean, default: true },
      digest: { type: Boolean, default: false },
      assigned: { type: Boolean, default: true },
      accountable: { type: Boolean, default: true },
      watched: { type: Boolean, default: false },
    },
    /** Secret token for read-only calendar (iCal) feeds; null when no feed was created. */
    icalToken: { type: String, default: null, select: false },
    icalTokenCreatedAt: { type: Date, default: null },
    /** Single sign-on identity: "<issuer>|<sub>" from the OpenID Connect provider. */
    ssoSubject: { type: String, default: undefined, index: { unique: true, sparse: true } },
    /** Two-factor authentication (TOTP). Secrets and backup codes never leave the server. */
    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String, default: null, select: false },
    totpPendingSecret: { type: String, default: null, select: false },
    /** SHA-256 hashes of unused one-time backup codes. */
    totpBackupCodes: { type: [String], default: [], select: false },
    /** Last accepted 30-second time step, so a code cannot be replayed. */
    totpLastStep: { type: Number, default: 0, select: false },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/** Reminder preferences with defaults filled in. */
export function reminderPrefs(user: UserDoc) {
  const r = user.reminders;
  return {
    dueSoonDays: r?.dueSoonDays ?? 1,
    overdue: r?.overdue !== false,
    digest: !!r?.digest,
    assigned: r?.assigned !== false,
    accountable: r?.accountable !== false,
    watched: !!r?.watched,
  };
}

/** Shape returned to clients — never includes the password hash. */
export function publicUser(user: UserDoc) {
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email ?? '',
    role: user.role as AppRole,
    isActive: user.isActive,
    emailVerified: !!user.emailVerified,
    notifyByEmail: user.notifyByEmail !== false,
    favorites: (user.favorites ?? []).map(String),
    dashboardWidgets: user.dashboardWidgets ?? null,
    kind: (user.kind ?? 'user') as 'user' | 'placeholder',
    invited: !!user.invited,
    globalRoles: (user.globalRoles ?? []).map(String),
    workSchedule: { hoursPerDay: user.workSchedule?.hoursPerDay ?? 8, workingDays: user.workSchedule?.workingDays ?? [1, 2, 3, 4, 5] },
    reminders: reminderPrefs(user),
    calendarFeed: !!user.icalTokenCreatedAt,
    /** Effective organisation-wide permissions (filled in by requireAuth). */
    globalPermissions: [...((user.$locals?.globalPerms as Set<string> | undefined) ?? [])],
    twoFactorEnabled: !!user.totpEnabled,
    sso: !!user.ssoSubject,
  };
}
