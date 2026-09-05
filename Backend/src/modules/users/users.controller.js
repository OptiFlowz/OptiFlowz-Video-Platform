import { sendSuccess, sendError } from '../../common/response.js';
import { searchUsersInternal } from './handlers/searchUsers.js';
import { assignRoleInternal } from './handlers/assignRole.js';
import { removeRoleInternal } from './handlers/removeRole.js';
import { getMyPermissionsInternal } from './handlers/getMyPermissions.js';

export async function getMyPermissions(req, res) {
  try {
    const permissions = await getMyPermissionsInternal(req.user?.sub || null);
    return sendSuccess(res, { permissions });
  } catch (error) {
    console.error('getMyPermissions error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function searchUsers(req, res) {
  try {
    const result = await searchUsersInternal(req.query);
    return sendSuccess(res, result);
  } catch (error) {
    console.error('searchUsers error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function assignRole(req, res) {
  try {
    const assignment = await assignRoleInternal(req.body, req.user?.sub || null);
    return sendSuccess(res, { assignment });
  } catch (error) {
    console.error('assignRole error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function removeRole(req, res) {
  try {
    const assignment = await removeRoleInternal(req.body, req.user?.sub || null);
    return sendSuccess(res, { assignment });
  } catch (error) {
    console.error('removeRole error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
