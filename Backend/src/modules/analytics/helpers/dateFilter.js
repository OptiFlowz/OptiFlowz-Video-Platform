/**
 * Builds an optional created_at filter for a parameterized SQL query.
 *
 * precedingParameterCount is the number of parameters already used by the
 * query. For example, pass 1 when videoId is $1 and 2 when videoId and another
 * value occupy $1 and $2.
 */
export function buildDateFilter(
  alias,
  fromDate,
  toDate,
  precedingParameterCount = 1,
  dateColumn = 'created_at',
) {
  const conditions = [];
  const values = [];

  if (fromDate) {
    values.push(fromDate);
    conditions.push(
      `${alias}.${dateColumn} >= $${precedingParameterCount + values.length}`,
    );
  }

  if (toDate) {
    values.push(toDate);
    conditions.push(
      `${alias}.${dateColumn} <= $${precedingParameterCount + values.length}`,
    );
  }

  return {
    sql: conditions.length ? ` AND ${conditions.join(' AND ')}` : '',
    values,
  };
}
