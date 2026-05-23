export type CreateQuizPayload = {
  title: string;
  description: string;
  is_active: boolean;
  time_limit_seconds: number;
  question_count: number;
  max_attempts: number;
  passing_score_percentage: number;
  answer_review_mode: "immediate" | "at_end";
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
  video_id: string | null;
  playlist_id?: string | null;
  explanation: string;
  points: number;
  position: number;
  options: ChoiceOption[];
  pairs: MatchingPair[];
};

export type CreateQuizQuestionPayload = {
  question_text: string;
  question_type: QuestionType;
  video_id: string | null;
  playlist_id?: string | null;
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  options: ChoiceOption[];
  pairs: MatchingPair[];
};

export type QuizRuleType =
  | "video_watch_percentage"
  | "video_watch_seconds"
  | (string & {});

export type CreateQuizRulePayload = {
  rule_type: QuizRuleType;
  video_id: string | null;
  is_active: boolean;
  required_percentage?: number;
  required_seconds?: number;
};

export type RuleDraftValues = {
  rule_type: QuizRuleType;
  video_id: string | null;
  is_active: boolean;
  required_percentage: string;
  required_seconds: string;
};

export type QuizQuestionSourceType = "playlist" | "video";

export type CreateQuizSourcePayload = {
  source_type: QuizQuestionSourceType;
  playlist_id?: string | null;
  video_id?: string | null;
  percentage: number;
  include_general_questions: boolean;
  fixed_question_count?: number | null;
};

export type SourceDraftValues = {
  source_type: QuizQuestionSourceType;
  playlist_id: string | null;
  video_id: string | null;
  percentage: string;
  include_general_questions: boolean;
  fixed_question_count: string;
};

export type QuizData = {
  id: string;
  video_id?: string;
  created_by?: string;
  title: string;
  description: string;
  is_active: boolean;
  time_limit_seconds: number;
  question_count: number;
  max_attempts: number;
  passing_score_percentage: number | string;
  answer_review_mode?: "immediate" | "at_end" | string;
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
  video_id: string | null;
  playlist_id?: string | null;
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
  video_id: string | null;
  playlist_id?: string | null;
  question_text: string;
  question_type: QuestionType;
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type QuizRuleApiResponse = {
  id?: string;
  rule_id?: string;
  quiz_id?: string;
  rule_type: QuizRuleType;
  video_id: string | null;
  playlist_id?: string | null;
  required_quiz_id?: string | null;
  required_percentage?: number | string | null;
  required_seconds?: number | string | null;
  is_active: boolean;
  video_title?: string | null;
  video_thumbnail?: string | null;
  playlist_title?: string | null;
  playlist_thumbnail?: string | null;
};

export type QuizRule = {
  id: string;
  quiz_id?: string;
  rule_type: QuizRuleType;
  video_id: string | null;
  playlist_id?: string | null;
  required_quiz_id?: string | null;
  required_percentage?: number | string | null;
  required_seconds?: number | string | null;
  is_active: boolean;
  video_title?: string | null;
  video_thumbnail?: string | null;
  playlist_title?: string | null;
  playlist_thumbnail?: string | null;
};

export type QuizQuestionSourceApiResponse = {
  id?: string;
  source_id?: string;
  quiz_id?: string;
  source_type: QuizQuestionSourceType;
  playlist_id?: string | null;
  playlist_title?: string | null;
  playlist_thumbnail?: string | null;
  video_id?: string | null;
  video_title?: string | null;
  video_thumbnail?: string | null;
  percentage?: number | string | null;
  question_count?: number | string | null;
  fixed_question_count?: number | string | null;
  include_general_questions?: boolean;
};

export type QuizQuestionSource = {
  id: string;
  quiz_id?: string;
  source_type: QuizQuestionSourceType;
  playlist_id: string | null;
  playlist_title?: string | null;
  playlist_thumbnail?: string | null;
  video_id: string | null;
  video_title?: string | null;
  video_thumbnail?: string | null;
  percentage: number | string | null;
  question_count?: number | string | null;
  fixed_question_count?: number | string | null;
  include_general_questions: boolean;
};
