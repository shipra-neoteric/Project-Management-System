import type { UserDoc } from '../models/User';
import type { ProjectPermission } from '../models/Access';
import type { ProjectDoc, ProjectRole } from '../models/Project';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: UserDoc;
      project?: ProjectDoc;
      projectRole?: ProjectRole;
      permissions?: Set<ProjectPermission>;
    }
  }
}

export {};
