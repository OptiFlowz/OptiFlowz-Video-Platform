import { randomInt } from 'node:crypto';
import { HttpError } from '../../../../common/httpError.js';
import { validateQuestionForActivation } from '../../questions/helpers/questions.validation.js';
import { createQuizSchema } from '../../quizzes/helpers/quizzes.validation.js';

export function attemptError(status, code, message) {
  return new HttpError(status, { code, message });
}
const invalid = message => attemptError(422, 'INVALID_QUIZ_CONFIGURATION', message);
const insufficient = () => attemptError(422, 'INSUFFICIENT_QUESTIONS', 'The candidate pool cannot satisfy all question quotas with distinct questions');

export function shuffled(values, random = randomInt) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const SETTINGS = [
  'question_count', 'time_limit_seconds', 'max_attempts', 'passing_score_percentage',
  'shuffle_questions', 'shuffle_options', 'has_certificate', 'min_answered_percentage',
  'min_correct_percentage', 'correctness_visibility', 'correct_answers_visibility',
  'explanation_visibility', 'explanation_incorrect_only', 'allow_answer_changes_after_check',
  'allow_attempt_review', 'show_final_score', 'scoring_mode',
];

export function snapshotQuizSettings(quiz) {
  const values = Object.fromEntries(SETTINGS.map(key => [key, quiz[key]]));
  for (const key of ['passing_score_percentage', 'min_answered_percentage', 'min_correct_percentage']) {
    values[key] = Number(values[key]);
  }
  const parsed = createQuizSchema.safeParse({ ...values, title: quiz.title, description: quiz.description, status: quiz.status });
  if (!parsed.success) throw invalid('Quiz settings are invalid');
  return Object.fromEntries(SETTINGS.map(key => [key, parsed.data[key]]));
}

export function sourceQuotas(sources, questionCount) {
  if (!Number.isInteger(questionCount) || questionCount < 1) throw invalid('question_count must be positive');
  const ordered = [...sources].sort((a, b) => a.position - b.position || (a.category_id ?? '~').localeCompare(b.category_id ?? '~'));
  if (!ordered.length) return [];
  if (new Set(ordered.map(source => source.category_id)).size !== ordered.length) throw invalid('Source categories must be unique');
  const percentages = ordered[0].question_percentage !== null;
  for (const source of ordered) {
    if (!Number.isInteger(source.position) || source.position < 0
      || (source.question_percentage !== null) === (source.question_count !== null)
      || (source.question_percentage !== null) !== percentages) throw invalid('Source allocation modes are invalid or mixed');
    if (percentages) {
      const value = Number(source.question_percentage);
      if (!Number.isFinite(value) || value <= 0 || value > 100
        || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw invalid('Invalid source percentage');
    } else if (!Number.isInteger(source.question_count) || source.question_count < 1) throw invalid('Invalid source question count');
  }
  if (!percentages) {
    if (ordered.reduce((sum, source) => sum + source.question_count, 0) !== questionCount) throw invalid('Source counts must sum to question_count');
    return ordered.map(source => ({ ...source, quota: source.question_count }));
  }
  const hundredths = ordered.map(source => Math.round(Number(source.question_percentage) * 100));
  if (hundredths.reduce((sum, value) => sum + value, 0) !== 10000) throw invalid('Source percentages must sum to 100');
  const quotas = ordered.map((source, i) => {
    const product = questionCount * hundredths[i];
    return { ...source, quota: Math.floor(product / 10000), remainder: product % 10000 };
  });
  const remaining = questionCount - quotas.reduce((sum, source) => sum + source.quota, 0);
  const priority = [...quotas].sort((a, b) => b.remainder - a.remainder || a.position - b.position || (a.category_id ?? '~').localeCompare(b.category_id ?? '~'));
  for (let i = 0; i < remaining; i++) priority[i].quota++;
  return quotas;
}

// Select disjoint category quotas from the quiz candidate pool.
export function selectAttemptQuestions(candidates, sources, settings, random = randomInt) {
  const quotas = sourceQuotas(sources, settings.question_count);
  if (new Set(candidates.map(question => question.id)).size !== candidates.length) throw invalid('Candidate questions must be unique');
  if (candidates.length < settings.question_count) throw insufficient();
  const randomized = shuffled(candidates, random);
  let selected;
  if (!quotas.length) {
    selected = randomized.slice(0, settings.question_count).map(question => ({ ...question, source_category_id: null }));
  } else {
    // Categories are disjoint: each question belongs to at most one category.
    // NULL selects only uncategorized candidates, never leftovers from other categories.
    selected = [];
    for (const source of quotas) {
      const eligible = randomized.filter(question => question.category_id === source.category_id);
      if (eligible.length < source.quota) throw insufficient();
      selected.push(...eligible.slice(0, source.quota).map(question => ({ ...question, source_category_id: source.category_id })));
    }
  }

  return settings.shuffle_questions ? shuffled(selected, random)
    : selected.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function validateCandidates(candidates) {
  for (const candidate of candidates) {
    const points = Number(candidate.max_points);
    if (!Number.isFinite(points) || points <= 0 || points > 99999999.99) throw invalid('Candidate max_points must be positive');
    try { validateQuestionForActivation(candidate.question_snapshot); }
    catch { throw invalid('The candidate pool contains an incomplete or invalid question'); }
  }
}

export function snapshotAttemptQuestions(selected, settings, random = randomInt) {
  const order = values => {
    const sorted = [...values].sort((a, b) => a.position - b.position || (a.option_no ?? a.item_no) - (b.option_no ?? b.item_no));
    return (settings.shuffle_options ? shuffled(sorted, random) : sorted).map((value, index) => ({ ...value, position: index + 1 }));
  };
  return selected.map((candidate, index) => ({
    question_no: index + 1, question_id: candidate.id, max_points: Number(candidate.max_points),
    question_snapshot: {
      ...candidate.question_snapshot,
      source_category_id: candidate.source_category_id,
      options: order(candidate.question_snapshot.options),
      matching_options: order(candidate.question_snapshot.matching_options),
      matching_items: order(candidate.question_snapshot.matching_items),
    },
  }));
}

// Starting or resuming returns only attempt metadata and its saved settings.
// Question snapshots stay in the database for a separate retrieval endpoint.
export function publicAttempt(attempt) {
  return {
    id: attempt.id, quiz_id: attempt.quiz_id, attempt_no: attempt.attempt_no, status: attempt.status,
    started_at: attempt.started_at, expires_at: attempt.expires_at,
    settings: attempt.settings_snapshot,
  };
}
