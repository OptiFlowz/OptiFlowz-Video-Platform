import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { quizEligibilitySchema, requireQuizAttemptUser } from '../helpers/quiz-attempts.validation.js';
import { getQuizAttemptEligibilityState } from '../repository/quiz-attempts.repository.js';
import { areQuizRequirementsMet } from '../../quiz-requirements/repository/quiz-requirements.repository.js';

// Advisory read only. Starting an attempt must recheck eligibility under a lock,
// and transition expired in_progress attempts before inserting a new attempt.
export async function getQuizEligibilityInternal(quizId, userId, database = writePool) {
  requireQuizAttemptUser(userId);
  const input = validateOrThrow(quizEligibilitySchema.safeParse({ quizId, userId }));
  const state = await getQuizAttemptEligibilityState(database, input.quizId, input.userId);
  const unavailable = {
    can_start: false, can_resume: false, reason: 'quiz_unavailable',
    active_attempt_id: null, attempts_used: null, max_attempts: null, attempts_remaining: null,
  };
  if (!state) return unavailable;

  const requirementsMet = await areQuizRequirementsMet(database, input.quizId, input.userId);
  if (requirementsMet === null) return unavailable;

  // Existing attempts may be resumed even when requirements or limits have changed.
  const reason = state.active_attempt_id ? 'active_attempt'
    : !requirementsMet ? 'requirements_not_met'
      : state.max_attempts !== null && state.attempts_used >= state.max_attempts ? 'max_attempts_reached'
        : null;

  return {
    can_start: reason === null,
    can_resume: reason === 'active_attempt',
    reason,
    active_attempt_id: state.active_attempt_id,
    attempts_used: state.attempts_used,
    max_attempts: state.max_attempts,
    attempts_remaining: state.max_attempts === null ? null : Math.max(0, state.max_attempts - state.attempts_used),
  };
}
