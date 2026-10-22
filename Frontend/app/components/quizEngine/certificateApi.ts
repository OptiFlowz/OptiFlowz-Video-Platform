import { fetchFn } from '~/API';
import { getToken } from '~/functions';
import type { PageInfo } from './model';

export type CertificateTemplateInput = {
  name: string; description: string | null; html_template: string; css_template: string;
  page_format: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape';
};
export type CertificateTemplate = CertificateTemplateInput & { id: string; user_id: string; created_at: string; updated_at: string };
export type CertificateTemplates = { templates: CertificateTemplate[]; pagination: PageInfo };
export const emptyTemplate: CertificateTemplateInput = { name: '', description: null, html_template: '', css_template: '', page_format: 'A4', orientation: 'landscape' };
export function templateInput(template: CertificateTemplateInput): CertificateTemplateInput {
  return { name: template.name.trim(), description: template.description?.trim() || null,
    html_template: template.html_template, css_template: template.css_template, page_format: template.page_format, orientation: template.orientation };
}
export async function certificateRequest<T>(path = '', method = 'GET', body?: CertificateTemplateInput, signal?: AbortSignal): Promise<T> {
  const result = await fetchFn<T & { success?: boolean; message?: string }>({ route: `api/certificates/certificate-templates${path}`, options: {
    method, signal, cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(templateInput(body)) }),
  } });
  if (result?.success === false) throw new Error(result.message || 'Request failed');
  return result;
}
