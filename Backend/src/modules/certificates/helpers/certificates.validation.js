import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';

export const certificateIdSchema = z.object({ id: z.string().uuid('Invalid certificate ID') });
export const listCertificatesSchema = z.object({
  status: z.enum(['issued', 'revoked']).optional(),
  quiz_id: z.string().uuid().optional(),
  certificate_template_id: z.string().uuid().optional(),
  certificate_number: z.string().trim().max(100).optional(),
  quiz_title: z.string().trim().max(255).optional(),
  issued_from: z.string().datetime({ offset: true }).optional(),
  issued_to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(['issued_at', 'created_at', 'certificate_number', 'quiz_title', 'status']).optional().default('issued_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
}).refine(query => !query.issued_from || !query.issued_to || Date.parse(query.issued_from) <= Date.parse(query.issued_to), {
  message: 'issued_from must not be after issued_to', path: ['issued_to'],
});

export function requireCertificateUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
