import { HttpError } from '../../../../common/httpError.js';

export function mapQuizSourceError(error) {
  if (error.code === '22003') return new HttpError(400, { message: 'The total question count exceeds the supported range' });
  if (['40P01', '40001'].includes(error.code)) return new HttpError(409, { message: 'Quiz structure changed concurrently; retry the request' });
  if (error.code === '23505' && ['quiz_sources_quiz_category_unique', 'quiz_sources_quiz_uncategorized_unique'].includes(error.constraint)) {
    return new HttpError(409, { message: 'This category or uncategorized source already exists for the quiz' });
  }
  const messages = {
    quiz_sources_same_user_check: 'The quiz and source categories must belong to the same user',
  };
  if (error.code === '23514' && messages[error.constraint]) {
    return new HttpError(400, { message: messages[error.constraint] });
  }
  return error;
}
