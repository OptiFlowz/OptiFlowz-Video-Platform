import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

const resources = {
  quizzes: { table: 'quizzes', prefix: 'QUIZZES', label: 'Quiz' },
  questions: { table: 'questions', prefix: 'QUESTIONS', label: 'Question' },
  categories: { table: 'question_categories', prefix: 'QUESTION_CATEGORIES', label: 'Question category' },
};
const uuid = z.string().uuid().transform(value => value.toLowerCase());

// Resolve an authorized owner scope without changing the authenticated actor.
// Existing owner-scoped handlers then preserve ownership and same-owner links,
// including when an administrator edits somebody else's resource.
export function requireQuizResourceAccess(resource, action, { source = 'params', key, list = false } = {}) {
  const definition = resources[resource];
  const ownPermission = Permissions[`${definition.prefix}_${action.toUpperCase()}_OWN`];
  const anyPermission = Permissions[`${definition.prefix}_${action.toUpperCase()}_ANY`];
  if (!ownPermission || !anyPermission) throw new Error('Unknown quiz resource permission');
  return async (req, res, next) => {
    try {
      const value = key ? req[source]?.[key] : undefined;
      let id;
      if (!list || value !== undefined) {
        const parsed = uuid.safeParse(value);
        if (!parsed.success) return res.status(400).json({ success: false, message: `Invalid ${definition.label.toLowerCase()} ID` });
        id = parsed.data;
      }
      const authorization = req.authorization || await loadAuthorization(req.user.sub);
      req.authorization = authorization;
      const canAccessAny = hasPermission(authorization, anyPermission);
      if (!canAccessAny && !hasPermission(authorization, ownPermission)) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }
      req.resourceAccess = { canAccessAny };
      if (id) {
        // Table names come only from the fixed resource map above.
        const { rows } = await writePool.query(`SELECT user_id FROM public.${definition.table} WHERE id=$1`, [id]);
        const ownerId = rows[0]?.user_id;
        if (!ownerId || (!canAccessAny && ownerId !== req.user.sub)) {
          return res.status(404).json({ success: false, message: `${definition.label} not found` });
        }
        req.resourceOwnerId = ownerId;
      }
      return next();
    } catch (error) { return next(error); }
  };
}
