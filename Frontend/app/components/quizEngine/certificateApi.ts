import { fetchApiResponse, fetchFn } from '~/API';
import { env } from '~/env';
import { getToken } from '~/functions';
import type { PageInfo } from './model';

export type CertificateTemplateInput = {
  name: string; description: string | null; html_template: string; css_template: string;
  page_format: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape';
};
export type CertificateTemplate = CertificateTemplateInput & { id: string; user_id: string | null; is_system: boolean; is_default: boolean; created_at: string; updated_at: string };
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

// The API sorts the combined set, but cannot filter system templates. Collect all
// pages before sorting/paginating so the defaults never disappear onto later pages.
export async function allCertificateTemplates(signal?: AbortSignal): Promise<CertificateTemplate[]> {
  const rows: CertificateTemplate[] = [];
  for (let page = 1; ; page++) {
    const result = await certificateRequest<CertificateTemplates>(`?page=${page}&limit=100&sortBy=name&sortOrder=asc`, 'GET', undefined, signal);
    rows.push(...result.templates);
    if (!result.pagination.hasNextPage) return rows.sort(compareCertificateTemplates);
    if (!result.templates.length) throw new Error('Incomplete list response');
  }
}
export function compareCertificateTemplates(a: CertificateTemplate, b: CertificateTemplate) {
  return Number(!!b.is_default) - Number(!!a.is_default) || Number(!!b.is_system) - Number(!!a.is_system) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
export async function previewCertificate(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetchApiResponse(`${env.apiBaseUrl}/api/certificates/certificate-templates/${encodeURIComponent(id)}/preview/pdf`, {
    method: 'POST', signal, cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/pdf' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || `HTTP ${response.status}`);
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/pdf')) throw new Error('Invalid PDF response');
  return response.blob();
}
