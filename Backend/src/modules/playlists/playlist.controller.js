import { getPlaylistByIdInternal } from './handlers/getPlaylistById.js';
import { getPlaylistVideosInternal } from './handlers/getPlaylistVideos.js';
import { playlistIncrementViewCountInternal } from './handlers/playlistIncrementViewCount.js';
import { getClientIp } from '../../common/ipUitl.js';


import { sendSuccess, sendError } from '../../common/response.js';

export async function getPlaylistById(req, res) {
    try{
        const playlist = await getPlaylistByIdInternal(req.params,req.user?.sub || null);

        if(!playlist){
            return  sendError(res,'Playlist not found', 404);
        }

        const view = await playlistIncrementViewCountInternal({
            "playlistId":req.params.id,
            "userId":req.user?.sub||null,
            "ip":getClientIp(req),
            "userAgent":req.get('user-agent') || '' });

        return sendSuccess(res,{playlist,view});
    }catch(error){
        console.log('Error fetching playlist by id:',error);
        return sendError(res,error.message,error.status||500)
    }
}

export async function getPlaylistVideos(req, res) {
    try{
        const result = await getPlaylistVideosInternal({...req.params, ...req.query},req.user?.sub || null);
        return sendSuccess(res,result);
    }catch(error){
        console.log('Error fetching playlist videos',error);
        return sendError(res,error.message,error.status||500)
    }
}