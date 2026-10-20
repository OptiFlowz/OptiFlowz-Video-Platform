export type QuestionType = 'single_choice' | 'multiple_choice' | 'matching';
export type Feedback = 'never' | 'after_check' | 'after_finish';
export type Owned = { id: string; user_id: string; created_at?: string; updated_at?: string };
export type Option = { option_no: number; content: string; position: number; is_correct?: boolean };
export type MatchItem = { item_no: number; content: string; position: number; correct_option_no: number };
export type Question = Owned & {
  type: QuestionType; content: string; explanation: string | null;
  groups: { id: string; name: string }[];
  options?: Option[]; matching_options?: Option[]; matching_items?: MatchItem[];
};
export type QuestionInput = Pick<Question, 'type' | 'content' | 'explanation'> & {
  options: Option[]; matching_options: Option[]; matching_items: MatchItem[]; group_ids?: string[];
};
export type Group = Owned & { name: string; description: string | null; questions?: Question[] };
export type QuizSettings = {
  title: string; description: string | null; status: 'draft' | 'published' | 'archived';
  question_count: number; time_limit_seconds: number | null; max_attempts: number | null;
  passing_score_percentage: number; min_answered_percentage: number; min_correct_percentage: number;
  shuffle_questions: boolean; shuffle_options: boolean; has_certificate: boolean;
  correctness_visibility: Feedback; correct_answers_visibility: Feedback; explanation_visibility: Feedback;
  explanation_incorrect_only: boolean; allow_answer_changes_after_check: boolean;
  allow_attempt_review: boolean; show_final_score: boolean; scoring_mode: 'exact_match' | 'partial_credit';
};
export type Quiz = Owned & QuizSettings;
export const defaultSettings: QuizSettings = {
  title: '', description: null, status: 'draft', question_count: 1, time_limit_seconds: null, max_attempts: null,
  passing_score_percentage: 50, min_answered_percentage: 0, min_correct_percentage: 0,
  shuffle_questions: true, shuffle_options: true, has_certificate: false,
  correctness_visibility: 'after_finish', correct_answers_visibility: 'after_finish', explanation_visibility: 'after_finish',
  explanation_incorrect_only: false, allow_answer_changes_after_check: false, allow_attempt_review: true,
  show_final_score: true, scoring_mode: 'exact_match',
};
export function settingsOf(quiz: Quiz): QuizSettings {
  return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, quiz[key as keyof QuizSettings]])) as QuizSettings;
}
export type Candidate = { quiz_id: string; question_id: string; position: number; max_points: number; question: Pick<Question, 'id' | 'type' | 'content' | 'explanation'> };
export type Source = { quiz_id?: string; group_id: string; position: number; question_percentage: number | null; question_count: number | null; group?: Pick<Group, 'id' | 'name' | 'description'> };
export type VideoCard = { id: string; title: string; duration_seconds?: number; thumbnail_url?: string | null; mux_thumbnail_url?: string | null };
export type Requirement = {
  quiz_id: string; video_id: string; position: number; min_watch_percentage: number | null; min_watch_seconds: number | null;
  video_card?: VideoCard | null; total_watch_seconds?: number; required_watch_seconds?: number | null;
  watched_percentage?: number | null; completion_percentage?: number | null; is_met?: boolean;
};
export type PageInfo = { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
export type Listing<T> = { items: T[]; pagination: PageInfo };
export const resourcePaths = { quizzes: '', questions: '/questions', groups: '/question-groups' };
export type Resource = keyof typeof resourcePaths;
export function resourcePermission(resource: Resource, action: string) { return `${resource === 'groups' ? 'question_groups' : resource}.${action}`; }
export const typeLabels = { single_choice: 'quizSingleChoice', multiple_choice: 'quizMultipleChoice', matching: 'quizMatching' };
