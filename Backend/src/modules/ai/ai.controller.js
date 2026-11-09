import { handleSearchVideosVector } from '../videos/video/video.controller.js';
import { HttpError } from '../../common/httpError.js';
import { findVideoChatSources } from './handlers/findVideoChatSources.js';

export function searchVideos(req, res) {
  if (typeof req.query.q !== 'string' || !req.query.q.trim()) {
    return res.status(400).json({ message: 'q must be a nonempty string' });
  }
  return handleSearchVideosVector(req, res);
}

export async function getVideoChatSources(req, res) {
  res.set('Cache-Control', 'private, no-store');
  try {
    const sources = await findVideoChatSources(req.body);
    return res.json({ sources });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json(error.body);
    console.error('Video chat source search failed:', error);
    return res.status(500).json({ message: 'Could not retrieve video chat sources' });
  }
}
