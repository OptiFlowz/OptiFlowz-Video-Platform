import { getChannelDetailsByIdInternal } from './handlers/getChannelDetailsById.js';
import { getChannelVideosInternal } from './handlers/getChannelVideos.js';
import { getChannelPlaylistsInternal } from './handlers/getChannelPlaylists.js';
import { sendSuccess, sendError } from '../../common/response.js';


export async function getChannelDetailsById(req, res) {
  try {
    const channel = await getChannelDetailsByIdInternal(req.params);
    if (!channel) 
      return sendError(res, 'Channel not found', 404);   
    return sendSuccess(res, { channel });
  } catch (error) {
    console.error('Error fetching channel by id:', error);
    return sendError(res,error.message, error.status || 500);
  }
}

export async function getChannelVideos(req, res) {
  try {
    const result = await getChannelVideosInternal({...req.params, ...req.query,},req.user?.sub || null);
    return sendSuccess(res,  result );
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    return sendError(res,error.message, error.status || 500);
  }
}

export async function getChannelPlaylists(req, res) {
  try {
    const result = await getChannelPlaylistsInternal({...req.params, ...req.query,},req.user?.sub || null);
    return sendSuccess(res,  result );
  } catch (error) {
    console.error('Error fetching channel playlists:', error);
    return sendError(res,error.message, error.status || 500);
  }
}