import { attemptError } from './attemptQuestions.js';
import { attemptAnswerSchemas } from './quiz-attempts.validation.js';
import { validateQuestionForActivation } from '../../questions/helpers/questions.validation.js';

const invalidAnswer = message => attemptError(400, 'INVALID_ANSWER', message);

export function validateAttemptQuestion(question) {
  const snapshot = question.question_snapshot;
  try {
    // Snapshots also contain internal metadata such as source_category_id.
    validateQuestionForActivation(Object.fromEntries(
      ['type', 'content', 'explanation', 'options', 'matching_options', 'matching_items']
        .map(key => [key, snapshot[key]])));
    const points = Number(question.max_points);
    if (!Number.isFinite(points) || points <= 0 || points > 99999999.99) throw new Error('Invalid points');
  } catch {
    throw attemptError(422, 'INVALID_ATTEMPT_QUESTION', 'The saved question is not valid for grading');
  }
}

// Store canonical order so reordering selections is an idempotent retry, not a change.
export function normalizeAttemptAnswer(snapshot, input) {
  const parsed = attemptAnswerSchemas[snapshot.type]?.safeParse(input);
  if (!parsed?.success) throw invalidAnswer(parsed?.error.issues[0]?.message || 'Unsupported question type');
  const answer = parsed.data;
  if (snapshot.type === 'matching') {
    const items = new Set(snapshot.matching_items.map(item => item.item_no));
    const options = new Set(snapshot.matching_options.map(option => option.option_no));
    if (answer.pairs.length !== items.size || answer.pairs.some(pair => !items.has(pair.item_no) || !options.has(pair.option_no))) {
      throw invalidAnswer('Provide exactly one valid option for every matching item');
    }
    // Multiple items may legitimately map to the same option in the snapshot.
    return { pairs: [...answer.pairs].sort((a, b) => a.item_no - b.item_no) };
  }
  const options = new Set(snapshot.options.map(option => option.option_no));
  const selected = snapshot.type === 'single_choice' ? [answer.option_no] : answer.option_nos;
  if (selected.some(number => !options.has(number))) throw invalidAnswer('Every selected option must belong to this question');
  return snapshot.type === 'single_choice' ? answer : { option_nos: [...selected].sort((a, b) => a - b) };
}

export function gradeAttemptAnswer(snapshot, answer, maxPoints, scoringMode) {
  if (!['exact_match', 'partial_credit'].includes(scoringMode)) {
    throw attemptError(422, 'INVALID_ATTEMPT_SETTINGS', 'The saved scoring mode is invalid');
  }
  let isCorrect, numerator, denominator;
  if (snapshot.type === 'matching') {
    const selections = new Map(answer.pairs.map(pair => [pair.item_no, pair.option_no]));
    numerator = snapshot.matching_items.filter(item => selections.get(item.item_no) === item.correct_option_no).length;
    denominator = snapshot.matching_items.length;
    isCorrect = numerator === denominator;
  } else {
    const selected = new Set(snapshot.type === 'single_choice' ? [answer.option_no] : answer.option_nos);
    const correct = snapshot.options.filter(option => option.is_correct);
    const correctSelected = correct.filter(option => selected.has(option.option_no)).length;
    const wrongSelected = selected.size - correctSelected;
    isCorrect = correctSelected === correct.length && wrongSelected === 0;
    const wrongTotal = snapshot.options.length - correct.length;
    // Clamp correctSelected/correctTotal - wrongSelected/wrongTotal at zero.
    numerator = Math.max(0, correctSelected * (wrongTotal || 1) - wrongSelected * correct.length);
    denominator = correct.length * (wrongTotal || 1);
  }
  if (scoringMode === 'exact_match' || snapshot.type === 'single_choice') {
    numerator = isCorrect ? 1 : 0;
    denominator = 1;
  }
  // Round once to decimal(10,2), without floating-point ratio/rounding drift.
  const cents = BigInt(Math.round(Number(maxPoints) * 100));
  const divisor = BigInt(denominator);
  const awardedCents = (2n * cents * BigInt(numerator) + divisor) / (2n * divisor);
  return { is_correct: isCorrect, awarded_points: Number(awardedCents) / 100 };
}

// Shared by answer writes and question retrieval; expiration is computed by PostgreSQL.
export function publicAttemptAnswer(attempt, question, saved) {
  const settings = attempt.settings_snapshot;
  const expired = attempt.expired === true;
  const finished = ['submitted', 'timed_out'].includes(attempt.status)
    || (attempt.status === 'in_progress' && expired);
  const checked = saved.checked_at != null;
  const canShow = visibility => checked && (
    (attempt.status === 'in_progress' && !expired && visibility === 'after_check')
    || (finished && settings.allow_attempt_review === true && ['after_check', 'after_finish'].includes(visibility))
  );
  const feedback = {};
  if (canShow(settings.correctness_visibility)) {
    feedback.is_correct = saved.is_correct;
    // Points can reveal correctness even when is_correct is omitted.
    feedback.awarded_points = Number(saved.awarded_points);
  }
  const snapshot = question.question_snapshot;
  if (canShow(settings.correct_answers_visibility)) {
    feedback.correct_answers = snapshot.type === 'matching'
      ? { matching_items: snapshot.matching_items.map(({ item_no, correct_option_no }) => ({ item_no, correct_option_no })) }
      : { options: snapshot.options.map(({ option_no, is_correct }) => ({ option_no, is_correct })) };
  }
  if (canShow(settings.explanation_visibility)
    && (settings.explanation_incorrect_only !== true || saved.is_correct === false)) {
    feedback.explanation = snapshot.explanation;
  }
  return {
    attempt_id: saved.attempt_id, question_no: saved.question_no, answer: saved.answer,
    checked_at: saved.checked_at, updated_at: saved.updated_at, feedback,
  };
}

export function publicAttemptQuestion(attempt, question) {
  const snapshot = question.question_snapshot;
  const saved = question.saved_answer;
  const response = saved ? publicAttemptAnswer(attempt, question, saved) : null;
  return {
    question_no: question.question_no, question_id: question.question_id,
    type: snapshot.type, content: snapshot.content, max_points: Number(question.max_points),
    // Explicit allowlists prevent answer keys, explanations or internal metadata
    // from escaping through the question or its option/item arrays.
    options: (snapshot.options ?? []).map(({ option_no, content, position }) => ({ option_no, content, position })),
    matching_options: (snapshot.matching_options ?? []).map(({ option_no, content, position }) => ({ option_no, content, position })),
    matching_items: (snapshot.matching_items ?? []).map(({ item_no, content, position }) => ({ item_no, content, position })),
    answer: response?.answer ?? null, checked_at: response?.checked_at ?? null,
    updated_at: response?.updated_at ?? null, feedback: response?.feedback ?? {},
    can_edit: attempt.status === 'in_progress' && attempt.expired !== true
      && (saved?.checked_at == null || attempt.settings_snapshot.allow_answer_changes_after_check === true),
  };
}
