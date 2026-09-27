import { writePool } from '../../database/index.js';
import { hasPermission, loadAuthorization } from './authorization.service.js';

export function requireContentPermission(action) {
  return async (req, res, next) => {
    try {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(req.params.id || '')) {
        return res.status(400).json({ message: 'Invalid video ID' });
      }
      const { rows } = await writePool.query('SELECT kind FROM videos WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ message: 'Video not found' });
      const permission = `${rows[0].kind === 'live' ? 'livestreams' : 'videos'}.${action}`;
      req.authorization ||= await loadAuthorization(req.user.sub);
      if (!hasPermission(req.authorization, permission)) return res.status(403).json({ message: 'Insufficient permissions', requiredPermission: permission });
      next();
    } catch (error) { next(error); }
  };
}

export async function requireMixedLibrary(req, res, next) {
  try {
    req.authorization ||= await loadAuthorization(req.user.sub);
    req.allowedVideoKinds = [['upload', 'videos.library.read'], ['live', 'livestreams.library.read']]
      .filter(([, permission]) => hasPermission(req.authorization, permission)).map(([kind]) => kind);
    if (!req.allowedVideoKinds.length) return res.status(403).json({ message: 'Insufficient permissions' });
    next();
  } catch (error) { next(error); }
}
