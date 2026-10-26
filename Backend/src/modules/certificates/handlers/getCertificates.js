import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { listCertificatesSchema, requireCertificateUser } from '../helpers/certificates.validation.js';
import { listCertificates } from '../repository/certificates.repository.js';

export async function getCertificatesInternal(query, userId) {
  requireCertificateUser(userId);
  const { page, limit, sortBy, sortOrder, ...filters } = validateOrThrow(listCertificatesSchema.safeParse(query));
  const { certificates, total } = await listCertificates(writePool, userId, {
    ...filters, sortBy, sortOrder, limit, offset: (page - 1) * limit,
  });
  const totalPages = Math.ceil(total / limit);
  return { certificates,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
