import { HttpError } from '../../../common/httpError.js';
import { hasPermission, loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

export async function requireCollectionFeaturePermission(userId, authorization) {
  const access = authorization || await loadAuthorization(userId);
  if (!hasPermission(access, Permissions.COLLECTIONS_FEATURE)) {
    throw new HttpError(403, { message: `Permission ${Permissions.COLLECTIONS_FEATURE} is required` });
  }
}
