import { request, all } from './api';
import type { Quiz, Candidate, Question, Source } from './model';
import { readiness } from './readiness';

export async function inspectQuiz(quiz: Pick<Quiz, 'id' | 'user_id'>) {
  const [fixed, sources] = await Promise.all([all<Candidate>(`/${quiz.id}/questions`, 'questions'), all<Source>(`/${quiz.id}/sources`, 'sources')]);
  const bank = sources.length ? (await all<Question>('/questions', 'questions')).filter(q => q.user_id === quiz.user_id
    && sources.some(s => s.category_id === (q.category?.id ?? null))) : [];
  const ids = [...new Set([...fixed.map(row => row.question_id), ...bank.map(q => q.id)])];
  const questions: Question[] = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(id => request<{ question: Question }>(`/questions/${id}`)));
    questions.push(...batch.map(result => result.question));
  }
  const fixedIds = new Set(fixed.map(row => row.question_id));
  return readiness(questions.filter(q => fixedIds.has(q.id)), sources, questions.filter(q => q.user_id === quiz.user_id));
}
