import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { listCertificateTemplatesSchema, requireCertificateUser } from '../helpers/certificate-templates.validation.js';
import { listCertificateTemplates } from '../repository/certificate-templates.repository.js';

export async function getCertificateTemplatesInternal(query, userId) {
  requireCertificateUser(userId);
  const { page, limit, sortBy, sortOrder, ...filters } = validateOrThrow(listCertificateTemplatesSchema.safeParse(query));
  const { templates, total } = await listCertificateTemplates(writePool, userId, {
    ...filters, limit, offset: (page - 1) * limit, sortBy, sortOrder,
  });
  const totalPages = Math.ceil(total / limit);
  return {
    templates,
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    sorting: { sortBy, sortOrder },
  };
}
