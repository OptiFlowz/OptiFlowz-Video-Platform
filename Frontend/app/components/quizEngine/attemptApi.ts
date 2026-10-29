import { fetchFn } from '~/API';
import { getToken } from '~/functions';

export type AttemptSettings = { questions_per_page?: number; allow_attempt_review?: boolean; correctness_visibility?: 'never' | 'after_check' | 'after_finish' };
export type Answer = { option_no: number | null } | { option_nos: number[] } | { pairs: { item_no: number; option_no: number }[] };
export type Feedback = {
  is_correct?: boolean; awarded_points?: number; explanation?: string | null;
  correct_answers?: { options?: { option_no: number; is_correct: boolean }[]; matching_items?: { item_no: number; correct_option_no: number }[] };
};
export type AttemptQuestion = {
  management_review?: true;
  question_no: number; question_id: string; type: 'single_choice' | 'multiple_choice' | 'matching'; content: string; max_points: number;
  options: { option_no: number; content: string; position: number }[];
  matching_options: { option_no: number; content: string; position: number }[];
  matching_items: { item_no: number; content: string; position: number }[];
  answer: Answer | null; checked_at: string | null; feedback: Feedback; can_edit: boolean;
};
export type AttemptQuestions = { attempt_id: string; status: string; expires_at: string | null; is_expired: boolean; settings?: AttemptSettings; result?: AttemptResult; questions: AttemptQuestion[] };
export type AttemptResult = { settings?: AttemptSettings; id: string; status: string; score_percentage: number | null; earned_points: number | null; max_points: number; passed: boolean | null };
export type SavedAnswer = { question_no: number; answer: Answer; checked_at: string | null; feedback: Feedback; can_edit: boolean };
export async function attemptRequest<T>(attemptId: string, path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const result = await fetchFn<T & { success?: boolean; message?: string }>({ route: `api/quiz-attempts/${encodeURIComponent(attemptId)}${path}`, options: {
    method, signal, keepalive: method === 'PUT', cache: 'no-store', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  } });
  if (result?.success === false) throw new Error(result.message || 'Request failed');
  return result;
}
export function isCompleteAnswer(question: AttemptQuestion, answer: Answer | null): answer is Answer {
  if (!answer) return false;
  if (question.type === 'single_choice') return 'option_no' in answer && question.options.some(o => o.option_no === answer.option_no);
  if (question.type === 'multiple_choice') return 'option_nos' in answer && answer.option_nos.length > 0;
  return 'pairs' in answer && question.matching_items.every(item => answer.pairs.some(pair => pair.item_no === item.item_no && question.matching_options.some(option => option.option_no === pair.option_no)));
}

/** Saved answers still need checking when the attempt uses per-question feedback. */
export function resumeQuestionIndex(questions: AttemptQuestion[], correctnessVisibility: AttemptSettings['correctness_visibility']): number {
  for (let index = questions.length - 1; index >= 0; index--) {
    const question = questions[index], answer = question.answer;
    const hasAnswer = answer && ('option_no' in answer ? answer.option_no != null : 'option_nos' in answer ? answer.option_nos.length > 0 : answer.pairs.length > 0);
    if (!hasAnswer && !question.checked_at) continue;
    if (!isCompleteAnswer(question, answer) || (correctnessVisibility === 'after_check' && (!question.checked_at || question.feedback.is_correct === false))) return index;
    return Math.min(index + 1, questions.length - 1);
  }
  return 0;
}
