import type { Answer, AttemptQuestion } from './attemptApi';
import type { Question, QuizSettings } from './model';

export type ResultUser = { id: string; full_name: string; image_url: string | null };
export type ManagedAttempt = {
  id: string; quiz_id: string; attempt_no: number;
  status: 'in_progress' | 'submitted' | 'timed_out' | 'cancelled';
  started_at: string; finished_at: string | null; expires_at: string | null;
  earned_points: number | null; max_points: number | null; score_percentage: number | null; passed: boolean | null;
};
export type ParticipantResults = { user: ResultUser; attempts: ManagedAttempt[] };
export type ManagedQuestion = {
  question_no: number; question_id: string | null; max_points: number;
  question_snapshot: Pick<Question, 'type' | 'content' | 'explanation' | 'options' | 'matching_items' | 'matching_options'>;
  answer: Answer | null; checked_at: string | null; updated_at: string | null;
  is_correct: boolean | null; awarded_points: number | null; can_edit: false;
};
export type ManagedAttemptDetail = ManagedAttempt & { user: ResultUser; settings: QuizSettings; is_expired: boolean; questions: ManagedQuestion[] };
export const attemptStatusLabels = { in_progress: 'quizInProgress', submitted: 'quizComplete', timed_out: 'qeTimedOut', cancelled: 'qeCancelled' };
export function canReadQuizResults(access: { canOwn: (own: string, any: string, ownerId?: string) => boolean }, ownerId?: string) {
  return access.canOwn('quizzes.attempts.read_own', 'quizzes.attempts.read_any', ownerId);
}

/** Passing once takes precedence over later failed or unfinished attempts. */
export function participantOutcome(attempts: Pick<ManagedAttempt, 'passed'>[]): boolean | null {
  return attempts.some(attempt => attempt.passed === true) ? true : attempts.some(attempt => attempt.passed === false) ? false : null;
}

/** Preserve saved snapshots and grading; never make a managed attempt editable. */
export function managedReviewQuestions(attempt: ManagedAttemptDetail): AttemptQuestion[] {
  return attempt.questions.map(q => ({
    management_review: true, question_no: q.question_no, question_id: q.question_id ?? '',
    type: q.question_snapshot.type, content: q.question_snapshot.content, max_points: q.max_points,
    options: q.question_snapshot.options ?? [], matching_items: q.question_snapshot.matching_items ?? [], matching_options: q.question_snapshot.matching_options ?? [],
    answer: q.answer, checked_at: q.checked_at, can_edit: false,
    feedback: {
      ...(q.is_correct == null ? {} : { is_correct: q.is_correct }),
      ...(q.awarded_points == null ? {} : { awarded_points: q.awarded_points }),
      explanation: q.question_snapshot.explanation,
      correct_answers: {
        ...(q.question_snapshot.options?.length ? { options: q.question_snapshot.options.map(o => ({ option_no: o.option_no, is_correct: o.is_correct === true })) } : {}),
        ...(q.question_snapshot.matching_items?.length ? { matching_items: q.question_snapshot.matching_items.map(i => ({ item_no: i.item_no, correct_option_no: i.correct_option_no })) } : {}),
      },
    },
  }));
}
