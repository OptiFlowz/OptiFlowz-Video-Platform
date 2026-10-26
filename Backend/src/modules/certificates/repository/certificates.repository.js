const COLUMNS = `id, user_id, quiz_id, quiz_attempt_id, certificate_template_id,
  certificate_number, status, issued_at, revoked_at, created_at,
  data_snapshot->'quiz'->>'title' AS quiz_title`;
const SORT_FIELDS = { issued_at: 'issued_at', created_at: 'created_at', certificate_number: 'certificate_number',
  quiz_title: 'quiz_title', status: 'status' };
const pattern = value => value ? `%${value.replace(/[\\%_]/g, '\\$&')}%` : null;

export async function listCertificates(database, userId, filters) {
  const field = Object.hasOwn(SORT_FIELDS, filters.sortBy) ? SORT_FIELDS[filters.sortBy] : 'issued_at';
  const ordering = `${field} ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, id ASC`;
  const { rows } = await database.query(`
    WITH owned AS (
      SELECT ${COLUMNS} FROM public.certificates
      WHERE user_id=$1
        AND ($2::text IS NULL OR status::text=$2)
        AND ($3::uuid IS NULL OR quiz_id=$3)
        AND ($4::uuid IS NULL OR certificate_template_id=$4)
        AND ($5::text IS NULL OR certificate_number ILIKE $5)
        AND ($6::text IS NULL OR data_snapshot->'quiz'->>'title' ILIKE $6)
        AND ($7::timestamptz IS NULL OR issued_at >= $7)
        AND ($8::timestamptz IS NULL OR issued_at <= $8)
    ), page AS (
      SELECT * FROM owned ORDER BY ${ordering} LIMIT $9 OFFSET $10
    )
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ordering}) FROM page), '[]'::jsonb) AS certificates,
      (SELECT count(*)::integer FROM owned) AS total
  `, [userId, filters.status ?? null, filters.quiz_id ?? null, filters.certificate_template_id ?? null,
    pattern(filters.certificate_number), pattern(filters.quiz_title), filters.issued_from ?? null, filters.issued_to ?? null,
    filters.limit, filters.offset]);
  return rows[0];
}

export async function getCertificate(database, id, userId) {
  const { rows } = await database.query(`SELECT ${COLUMNS}, data_snapshot, template_snapshot
    FROM public.certificates WHERE id=$1 AND user_id=$2`, [id, userId]);
  return rows[0] || null;
}
