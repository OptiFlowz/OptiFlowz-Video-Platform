import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';

const fields = {
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().nullable(),
  html_template: z.string().refine(value => value.trim().length > 0, 'HTML template must not be empty'),
  css_template: z.string(),
  page_format: z.enum(['A4', 'Letter']),
  orientation: z.enum(['portrait', 'landscape']),
};

export const certificateTemplateIdSchema = z.object({ id: z.string().uuid('Invalid certificate template ID') });
export const createCertificateTemplateSchema = z.object({
  ...fields,
  description: fields.description.optional().default(null),
  css_template: fields.css_template.optional().default(''),
  page_format: fields.page_format.optional().default('A4'),
  orientation: fields.orientation.optional().default('landscape'),
}).strict();
export const updateCertificateTemplateSchema = z.object(fields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one certificate template field to update' },
);
export const listCertificateTemplatesSchema = z.object({
  name: z.string().trim().max(255).optional(),
  page_format: fields.page_format.optional(),
  orientation: fields.orientation.optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'name', 'page_format', 'orientation']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireCertificateUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}
