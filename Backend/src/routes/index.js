import authRoutes from '../modules/auth/auth.routes.js';
import peopleRoutes from '../modules/people/people.routes.js';
import playlistRoutes from '../modules/playlists/playlist.routes.js';
import playlistModerationRoutes from '../modules/playlists/playlist-moderation.routes.js';
import reportRoutes from '../modules/reports/report.routes.js';
import videoModerationRoutes from '../modules/videos/video-moderation.routes.js';
import videoRoutes from '../modules/videos/video.routes.js';
import commentRoutes from '../modules/comments/comments.routes.js';

export function registerRoutes(app) {
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/videos', videoRoutes);
  app.use('/api/video-moderation', videoModerationRoutes);
  app.use('/api/people', peopleRoutes);
  app.use('/api/playlists', playlistRoutes);
  app.use('/api/playlists-moderation', playlistModerationRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/comments',commentRoutes)
}
