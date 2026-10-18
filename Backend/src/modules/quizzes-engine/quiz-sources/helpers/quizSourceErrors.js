import { HttpError } from '../../../../common/httpError.js';

export function mapQuizSourceError(error) {
  if (error.code === '23505' && error.constraint === 'quiz_sources_pkey') {
    return new HttpError(409, { message: 'This group is already a source for the quiz' });
  }
  const messages = {
    quiz_sources_same_user_check: 'The quiz and source groups must belong to the same user',
    quiz_sources_one_mode_check: 'Exactly one of question_percentage and question_count must be set',
    quiz_sources_allocation_mode_check: 'All quiz sources must use the same allocation mode',
    quiz_sources_percentage_total_check: 'Source percentages must sum to 100; replace the complete allocation using PUT',
    quiz_sources_count_total_check: 'Source question counts must sum to the quiz question_count; replace the complete allocation using PUT',
  };
  if (error.code === '23514' && messages[error.constraint]) {
    return new HttpError(400, { message: messages[error.constraint] });
  }
  return error;
}
