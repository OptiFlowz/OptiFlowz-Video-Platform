function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))];
}

function normalizeChoiceAnswer(answer) {
  if (Array.isArray(answer)) {
    return uniqueStrings(answer);
  }

  if (Array.isArray(answer?.option_ids)) {
    return uniqueStrings(answer.option_ids);
  }

  if (answer?.option_id) {
    return [String(answer.option_id)];
  }

  return [];
}

function normalizeMatchingAnswer(answer) {
  const submittedPairs = Array.isArray(answer) ? answer : answer?.pairs;

  if (!Array.isArray(submittedPairs)) {
    return new Map();
  }

  return new Map(
    submittedPairs
      .map((pair) => [
        String(pair.left_pair_id || pair.left_id || pair.id || ''),
        String(pair.right_pair_id || pair.right_id || pair.matched_pair_id || ''),
      ])
      .filter(([leftId, rightId]) => leftId && rightId)
  );
}

function buildResult(isCorrect, awardedPoints) {
  if (isCorrect) {
    return 'correct';
  }

  return awardedPoints > 0 ? 'partial' : 'incorrect';
}

function applyScoringMode(review, scoring, isCorrect) {
  if (scoring !== 'strict' || isCorrect) {
    return review;
  }

  return {
    ...review,
    result: 'incorrect',
    awarded_points: 0,
  };
}

export function gradeQuizAnswer({ question, answer, options = [], pairs = [], scoring = 'partial' }) {
  const maxPoints = Number(question.points || 0);

  if (question.question_type === 'single_choice') {
    const selectedOptionIds = normalizeChoiceAnswer(answer);
    const correctOption = options.find((option) => option.is_correct);
    const isCorrect = selectedOptionIds.length === 1 && selectedOptionIds[0] === String(correctOption?.id);
    const awardedPoints = isCorrect ? maxPoints : 0;

    const review = {
      result: buildResult(isCorrect, awardedPoints),
      awarded_points: awardedPoints,
      max_points: maxPoints,
      correct_option_ids: correctOption ? [correctOption.id] : [],
      selected_option_ids: selectedOptionIds,
      explanation: question.explanation || null,
    };

    return applyScoringMode(review, scoring, isCorrect);
  }

  if (question.question_type === 'multiple_choice') {
    const selectedOptionIds = normalizeChoiceAnswer(answer);
    const correctOptionIds = options.filter((option) => option.is_correct).map((option) => String(option.id));
    const correctOptionIdSet = new Set(correctOptionIds);
    const selectedOptionIdSet = new Set(selectedOptionIds);
    const correctSelectedCount = selectedOptionIds.filter((id) => correctOptionIdSet.has(id)).length;
    const incorrectSelectedCount = selectedOptionIds.filter((id) => !correctOptionIdSet.has(id)).length;
    const scoreRatio =
      correctOptionIds.length > 0
        ? Math.max((correctSelectedCount - incorrectSelectedCount) / correctOptionIds.length, 0)
        : 0;
    const awardedPoints = Number((maxPoints * Math.min(scoreRatio, 1)).toFixed(2));
    const isCorrect =
      correctOptionIds.length === selectedOptionIds.length &&
      correctOptionIds.every((id) => selectedOptionIdSet.has(id));

    const review = {
      result: buildResult(isCorrect, awardedPoints),
      awarded_points: awardedPoints,
      max_points: maxPoints,
      correct_option_ids: correctOptionIds,
      selected_option_ids: selectedOptionIds,
      explanation: question.explanation || null,
    };

    return applyScoringMode(review, scoring, isCorrect);
  }

  if (question.question_type === 'matching') {
    const submittedPairMap = normalizeMatchingAnswer(answer);
    const correctCount = pairs.filter((pair) => submittedPairMap.get(String(pair.id)) === String(pair.id)).length;
    const scoreRatio = pairs.length > 0 ? correctCount / pairs.length : 0;
    const awardedPoints = Number((maxPoints * scoreRatio).toFixed(2));
    const isCorrect = pairs.length > 0 && correctCount === pairs.length;

    const review = {
      result: buildResult(isCorrect, awardedPoints),
      awarded_points: awardedPoints,
      max_points: maxPoints,
      correct_pairs: pairs.map((pair) => ({
        left_pair_id: pair.id,
        right_pair_id: pair.id,
      })),
      explanation: question.explanation || null,
    };

    return applyScoringMode(review, scoring, isCorrect);
  }

  return {
    result: 'incorrect',
    awarded_points: 0,
    max_points: maxPoints,
    explanation: question.explanation || null,
  };
}
