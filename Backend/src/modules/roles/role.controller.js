import { sendError, sendSuccess } from '../../common/response.js';
import { getPermissionsInternal } from './handlers/getPermissions.js';
import { getRolesInternal } from './handlers/getRoles.js';
import { createRoleInternal } from './handlers/createRole.js';
import { updateRoleInternal } from './handlers/updateRole.js';
import { deleteRoleInternal } from './handlers/deleteRole.js';

function sendRoleError(res, error, operation) {
  if (!error.status || error.status >= 500) {
    console.error(`Role ${operation} error:`, error);
  }

  return sendError(
    res,
    error.message,
    error.status || 500,
    error.status && error.status < 500 && error.code
      ? { code: error.code }
      : {},
  );
}

export async function getPermissions(_req, res) {
  try {
    const result = await getPermissionsInternal();
    return sendSuccess(res, result);
  } catch (error) {
    return sendRoleError(res, error, 'permission-list');
  }
}

export async function getRoles(req, res) {
  try {
    const roles = await getRolesInternal(req.authorization);
    return sendSuccess(res, { roles });
  } catch (error) {
    return sendRoleError(res, error, 'list');
  }
}

export async function createRole(req, res) {
  try {
    const role = await createRoleInternal(req.body, req.user?.sub);
    return sendSuccess(res, { role }, 201);
  } catch (error) {
    return sendRoleError(res, error, 'creation');
  }
}

export async function updateRole(req, res) {
  try {
    const role = await updateRoleInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { role });
  } catch (error) {
    return sendRoleError(res, error, 'update');
  }
}

export async function deleteRole(req, res) {
  try {
    const result = await deleteRoleInternal(req.params, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    return sendRoleError(res, error, 'deletion');
  }
}
