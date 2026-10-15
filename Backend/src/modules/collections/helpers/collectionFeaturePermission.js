import { HttpError } from '../../../common/httpError.js';
import { loadAuthorization } from '../../authorization/authorization.service.js';
import { Permissions } from '../../authorization/permission.constants.js';

export async function requireCollectionFeaturePermission(userId, authorization) {
  const access = authorization || await loadAuthorization(userId);
  // Featuring requires an explicit role grant, including for Owner roles; deny wins.
  if (access.permissions.get(Permissions.COLLECTIONS_FEATURE) !== 'allow') {
    throw new HttpError(403, { message: `Permission ${Permissions.COLLECTIONS_FEATURE} is required` });
  }
}
