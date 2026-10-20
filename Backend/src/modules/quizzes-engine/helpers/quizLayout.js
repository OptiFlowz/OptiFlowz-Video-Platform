// Caller holds the quiz write lock; tables and ID columns below are fixed constants.
// Shift both fixed-question positions and random-category block positions.
export async function shiftQuizLayout(database, quizId, kind, itemId, oldPosition, newPosition, { sourcesOnly = false } = {}) {
  if (oldPosition === newPosition) return;
  for (const [table, key, itemKind] of [
    ['quiz_questions', 'question_id', 'fixed'], ['quiz_sources', 'id', 'source'],
  ]) {
    if (sourcesOnly && itemKind === 'fixed') continue;
    await database.query(`UPDATE public.${table}
      SET position = CASE WHEN $3::integer < $2::integer THEN position + 1 ELSE position - 1 END
      WHERE quiz_id=$1 AND (${itemKind === kind ? `${key} <> $4` : '$4::uuid IS NOT NULL'}) AND (
        ($3::integer < $2::integer AND position >= $3 AND position < $2)
        OR ($3::integer > $2::integer AND position > $2 AND position <= $3)
      )`, [quizId, oldPosition, newPosition, itemId]);
  }
}
