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
  const { question_count, ...writable } = values;
  if (!Number.isInteger(question_count) || question_count < 1) throw invalid('The quiz must contain at least one question');
  const parsed = createQuizSchema.safeParse({ ...writable, title: quiz.title, description: quiz.description, status: quiz.status });
  if (!parsed.success) throw invalid('Quiz settings are invalid');
  return Object.fromEntries(SETTINGS.map(key => [key, key === 'question_count' ? question_count : parsed.data[key]]));
}

// Sources are positive counts, independent of the number of fixed questions.
export function sourceQuotas(sources) {
  if (new Set(sources.map(source => source.category_id)).size !== sources.length) throw invalid('Source categories must be unique');
  return sources.map(source => {
    if (!Number.isInteger(source.question_count) || source.question_count < 1
      || !Number.isInteger(source.position) || source.position < 0
      || (source.max_points !== null && (!Number.isFinite(Number(source.max_points)) || Number(source.max_points) <= 0
      || Number(source.max_points) > 99999999.99))) throw invalid('Invalid random category source');
    return { ...source, quota: source.question_count };
  });
}

export function selectAttemptQuestions(candidates, sources, settings, random = randomInt) {
  const quotas = sourceQuotas(sources);
  if (new Set(candidates.map(question => question.id)).size !== candidates.length) throw invalid('Question IDs must be unique');
  const fixed = candidates.filter(question => question.is_fixed);
  const count = fixed.length + quotas.reduce((sum, source) => sum + source.quota, 0);
  if (count < 1 || count !== settings.question_count) throw invalid('The derived question count does not match the quiz structure');
  const blocks = fixed.map(question => ({ position: question.position, kind: 0, id: question.id,
    questions: [{ ...question, source_category_id: null, source_id: null }] }));
  // Every fixed question is excluded from every source, even when it belongs to that category.
  const randomPool = shuffled(candidates.filter(question => !question.is_fixed), random);
  for (const source of quotas) {
    const eligible = randomPool.filter(question => question.category_id === source.category_id);
    if (eligible.length < source.quota) throw insufficient();
    blocks.push({ position: source.position, kind: 1, id: source.id,
      questions: eligible.slice(0, source.quota).map(question => ({ ...question,
        max_points: Number(source.max_points === null ? question.max_points : source.max_points),
        source_category_id: source.category_id, source_id: source.id })) });
  }
  // Positions are shared by fixed questions and random blocks; fixed wins a tie,
  // then the resource UUID. Random block contents retain their sampled order.
  blocks.sort((a, b) => a.position - b.position || a.kind - b.kind || a.id.localeCompare(b.id));
  const selected = blocks.flatMap(block => block.questions);
  return settings.shuffle_questions ? shuffled(selected, random) : selected;
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
      source_id: candidate.source_id,
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
