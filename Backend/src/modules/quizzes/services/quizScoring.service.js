function arraysEqualAsSets(a = [], b = []) {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map(String));
  return b.every((value) => setA.has(String(value)));
}

function scoreSingleChoice(question, answer) {
  const selectedOptionId = answer?.selected_option_id;
  const correctOption = question.options.find((option) => option.is_correct);
  const isCorrect = Boolean(correctOption && String(correctOption.id) === String(selectedOptionId));

  return {
    is_correct: isCorrect,
    awarded_points: isCorrect ? Number(question.points) : 0,
  };
}

function scoreMultipleChoice(question, answer) {
  const selectedOptionIds = Array.isArray(answer?.selected_option_ids)
    ? answer.selected_option_ids.map(String)
    : [];

  const correctOptionIds = question.options
    .filter((option) => option.is_correct)
    .map((option) => String(option.id));

  const isCorrect = arraysEqualAsSets(selectedOptionIds, correctOptionIds);

  return {
    is_correct: isCorrect,
    awarded_points: isCorrect ? Number(question.points) : 0,
  };
}

function scoreMatching(question, answer) {
  const pairs = Array.isArray(answer?.pairs) ? answer.pairs : [];

  const correctMap = new Map(
    question.pairs.map((pair) => [String(pair.id), String(pair.id)])
  );

  const validPairsCount = question.pairs.length;
  const correctCount = pairs.reduce((count, pairAnswer) => {
    const leftPairId = String(pairAnswer.left_pair_id || '');
    const selectedRightPairId = String(pairAnswer.selected_right_pair_id || '');
    return correctMap.get(leftPairId) === selectedRightPairId ? count + 1 : count;
  }, 0);

  const isCorrect = validPairsCount > 0 && correctCount === validPairsCount;
  const awardedPoints = validPairsCount > 0
    ? (Number(question.points) * correctCount) / validPairsCount
    : 0;

  return {
    is_correct: isCorrect,
    awarded_points: Number(awardedPoints.toFixed(2)),
  };
}

export function scoreQuestion(question, answer) {
  if (question.question_type === 'single_choice') {
    return scoreSingleChoice(question, answer);
  }

  if (question.question_type === 'multiple_choice') {
    return scoreMultipleChoice(question, answer);
  }

  if (question.question_type === 'matching') {
    return scoreMatching(question, answer);
  }

  const error = new Error('Unsupported question type');
  error.status = 400;
  throw error;
}

export function scoreAttempt(questions, answersByQuestionId) {
  let scorePoints = 0;
  let maxPoints = 0;

  const scoredAnswers = questions.map((question) => {
    const answer = answersByQuestionId.get(String(question.id)) || null;
    const scored = scoreQuestion(question, answer);

    scorePoints += Number(scored.awarded_points || 0);
    maxPoints += Number(question.points || 0);

    return {
      question_id: question.id,
      answer,
      ...scored,
    };
  });

  const scorePercentage = maxPoints > 0 ? Number(((scorePoints / maxPoints) * 100).toFixed(2)) : 0;

  return {
    score_points: Number(scorePoints.toFixed(2)),
    max_points: Number(maxPoints.toFixed(2)),
    score_percentage: scorePercentage,
    scored_answers: scoredAnswers,
  };
}
