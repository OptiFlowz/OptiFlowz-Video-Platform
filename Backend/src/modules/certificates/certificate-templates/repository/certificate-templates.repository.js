const COLUMNS = 'id, user_id, name, description, html_template, css_template, page_format, orientation, created_at, updated_at';
const WRITABLE_FIELDS = ['name', 'description', 'html_template', 'css_template', 'page_format', 'orientation'];
const SORT_FIELDS = { created_at: 'created_at', updated_at: 'updated_at', name: 'name', page_format: 'page_format', orientation: 'orientation' };

export async function createCertificateTemplate(database, userId, template) {
  const placeholders = WRITABLE_FIELDS.map((_, index) => `$${index + 2}`);
  const { rows } = await database.query(`
    INSERT INTO public.certificate_templates (user_id, ${WRITABLE_FIELDS.join(', ')})
    VALUES ($1, ${placeholders.join(', ')}) RETURNING ${COLUMNS}
  `, [userId, ...WRITABLE_FIELDS.map(field => template[field])]);
  return rows[0];
}

export async function getCertificateTemplate(database, id, userId) {
  const { rows } = await database.query(`
    SELECT ${COLUMNS} FROM public.certificate_templates WHERE id = $1 AND user_id = $2
  `, [id, userId]);
  return rows[0] || null;
}

export async function listCertificateTemplates(database, userId, { name, page_format, orientation, limit, offset, sortBy, sortOrder }) {
  const pattern = name ? `%${name.replace(/[\\%_]/g, '\\$&')}%` : null;
  const field = Object.hasOwn(SORT_FIELDS, sortBy) ? SORT_FIELDS[sortBy] : SORT_FIELDS.created_at;
  const ordering = `${field} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}, id ASC`;
  const { rows } = await database.query(`
    WITH owned_templates AS (
      SELECT ${COLUMNS} FROM public.certificate_templates
      WHERE user_id = $1 AND ($2::text IS NULL OR name ILIKE $2)
        AND ($3::text IS NULL OR page_format = $3) AND ($4::text IS NULL OR orientation = $4)
    ), page AS (
      SELECT * FROM owned_templates ORDER BY ${ordering} LIMIT $5 OFFSET $6
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS templates,
      (SELECT count(*)::integer FROM owned_templates) AS total
  `, [userId, pattern, page_format ?? null, orientation ?? null, limit, offset]);
  return rows[0];
}

export async function updateCertificateTemplate(database, id, userId, updates) {
  const fields = WRITABLE_FIELDS.filter(field => updates[field] !== undefined);
  const assignments = fields.map((field, index) => `${field} = $${index + 3}`);
  const { rows } = await database.query(`
    UPDATE public.certificate_templates SET ${assignments.join(', ')}, updated_at = now()
    WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}
  `, [id, userId, ...fields.map(field => updates[field])]);
  return rows[0] || null;
}

export async function deleteCertificateTemplate(database, id, userId) {
  const { rowCount } = await database.query(
    'DELETE FROM public.certificate_templates WHERE id = $1 AND user_id = $2', [id, userId],
  );
  return rowCount > 0;
}
