export const answerSettings = {
  min_answered_percentage: 0, min_correct_percentage: 0, passing_score_percentage: 50,
  scoring_mode: 'exact_match', correctness_visibility: 'after_finish',
  correct_answers_visibility: 'after_finish', explanation_visibility: 'after_finish',
  explanation_incorrect_only: false, allow_answer_changes_after_check: false,
  allow_attempt_review: true, show_final_score: true,
};

export function answerSnapshot(type = 'single_choice') {
  return {
    type, content: 'Snapshot question', explanation: 'SECRET explanation', source_category_id: null,
    options: type === 'matching' ? [] : [1, 2, 3, 4].map(option_no => ({
      option_no, content: `Option ${option_no}`, position: 5 - option_no,
      is_correct: option_no === 1 || (type === 'multiple_choice' && option_no === 2),
    })),
    matching_options: type !== 'matching' ? [] : [1, 2].map(option_no => ({ option_no, content: `Option ${option_no}`, position: option_no })),
    matching_items: type !== 'matching' ? [] : [1, 2, 3].map(item_no => ({ item_no, content: `Item ${item_no}`, position: item_no, correct_option_no: item_no === 2 ? 2 : 1 })),
  };
}
