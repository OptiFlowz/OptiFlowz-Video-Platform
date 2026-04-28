export function sanitizeQuestionForUser(question, { shuffleOptions = true } = {}) {
  const sanitized = {
    id: question.id,
    question_text: question.question_text,
    question_type: question.question_type,
    points: question.points,
  };

  if (question.question_type === 'single_choice' || question.question_type === 'multiple_choice') {
    const options = (question.options || []).map((option) => ({
      id: option.id,
      option_text: option.option_text,
    }));

    sanitized.options = shuffleOptions ? shuffleArray(options) : options;
  }

  if (question.question_type === 'matching') {
    const pairs = question.pairs || [];

    sanitized.left_items = pairs.map((pair) => ({
      id: pair.id,
      text: pair.left_text,
    }));

    const rightItems = pairs.map((pair) => ({
      id: pair.id,
      text: pair.right_text,
    }));

    sanitized.right_items = shuffleOptions ? shuffleArray(rightItems) : rightItems;
  }

  return sanitized;
}

export function shuffleArray(array) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function buildAttemptResponse(attempt, questions = []) {
  return {
    ...attempt,
    questions: questions.map((question, index) => ({
      ...question,
    })),
  };
}
