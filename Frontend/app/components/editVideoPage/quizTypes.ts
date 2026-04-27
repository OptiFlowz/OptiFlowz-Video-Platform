export type CreateQuizPayload = {
  title: string;
  description: string;
  is_active: boolean;
  time_limit_seconds: number;
  question_count: number;
  max_attempts: number;
  passing_score_percentage: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
};

export type QuestionType = "single_choice" | "multiple_choice" | "matching";

export type ChoiceOption = {
  option_text: string;
  is_correct: boolean;
};

export type MatchingPair = {
  left_text: string;
  right_text: string;
};

export type QuestionDraftValues = {
  question_text: string;
  question_type: QuestionType;
  explanation: string;
  points: number;
  position: number;
  options: ChoiceOption[];
  pairs: MatchingPair[];
};

export type CreateQuizQuestionPayload = {
  question_text: string;
  question_type: QuestionType;
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  options: ChoiceOption[];
  pairs: MatchingPair[];
};

export type QuizData = {
  id: string;
  video_id: string;
  title: string;
  description: string;
  is_active: boolean;
  time_limit_seconds: number;
  question_count: number;
  max_attempts: number;
  passing_score_percentage: number | string;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  created_at?: string;
  updated_at?: string;
};

export type QuestionOption = {
  id: string;
  question_id: string;
  option_text: string;
  is_correct: boolean;
  position: number;
  created_at?: string;
};

export type QuestionPair = {
  id: string;
  question_id: string;
  left_text: string;
  right_text: string;
  position: number;
  created_at?: string;
};

export type QuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  question_type: QuestionType;
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  options: QuestionOption[];
  pairs: QuestionPair[];
};

export type QuizQuestionResponse = {
  id: string;
  quiz_id: string;
  question_text: string;
  question_type: QuestionType;
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};
