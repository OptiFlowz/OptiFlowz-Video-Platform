export type QuestionType = 'single_choice' | 'multiple_choice' | 'matching';
export type Feedback = 'never' | 'after_check' | 'after_finish';
export type Owned = { id: string; user_id: string; created_at?: string; updated_at?: string };
export type Option = { option_no: number; content: string; position: number; is_correct?: boolean };
export type MatchItem = { item_no: number; content: string; position: number; correct_option_no: number };
export type Question = Owned & {
  type: QuestionType; content: string; explanation: string | null; max_points: number;
  category: { id: string; name: string } | null;
  options?: Option[]; matching_options?: Option[]; matching_items?: MatchItem[];
};
export type QuestionInput = Pick<Question, 'type' | 'content' | 'explanation' | 'max_points'> & {
  options: Option[]; matching_options: Option[]; matching_items: MatchItem[]; category_id?: string | null;
};
export type Category = Owned & { name: string; description: string | null; question_count: number; questions?: Question[] };
export type QuizSettings = {
  title: string; description: string | null; status: 'draft' | 'published' | 'archived';
  questions_per_page: number; time_limit_seconds: number | null; max_attempts: number | null;
  passing_score_percentage: number; min_answered_percentage: number; min_correct_percentage: number;
  shuffle_questions: boolean; shuffle_options: boolean; has_certificate: boolean;
  correctness_visibility: Feedback; correct_answers_visibility: Feedback; explanation_visibility: Feedback;
  explanation_incorrect_only: boolean; allow_answer_changes_after_check: boolean;
  allow_attempt_review: boolean; show_final_score: boolean; scoring_mode: 'exact_match' | 'partial_credit';
};
export type Quiz = Owned & QuizSettings & { question_count: number };
export const defaultSettings: QuizSettings = {
  title: '', description: null, status: 'draft', questions_per_page: 1, time_limit_seconds: null, max_attempts: null,
  passing_score_percentage: 50, min_answered_percentage: 0, min_correct_percentage: 0,
  shuffle_questions: true, shuffle_options: true, has_certificate: false,
  correctness_visibility: 'after_finish', correct_answers_visibility: 'after_finish', explanation_visibility: 'after_finish',
  explanation_incorrect_only: false, allow_answer_changes_after_check: true, allow_attempt_review: true,
  show_final_score: true, scoring_mode: 'exact_match',
};
export function settingsOf(quiz: Quiz): QuizSettings {
  return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, key === 'questions_per_page' ? quiz.questions_per_page ?? 1 : quiz[key as keyof QuizSettings]])) as QuizSettings;
}
export type Candidate = { quiz_id: string; question_id: string; position: number; max_points: number; question: Pick<Question, 'id' | 'type' | 'content' | 'explanation'> & Partial<Pick<Question, 'category'>> };
export type Source = { id?: string; quiz_id?: string; category_id: string | null; position: number; question_count: number; max_points: number | null; category?: Pick<Category, 'id' | 'name' | 'description'> | null };
export type VideoCard = { id: string; title: string; duration_seconds?: number; thumbnail_url?: string | null; mux_thumbnail_url?: string | null };
export type Requirement = {
  quiz_id: string; video_id: string; is_active?: boolean; position: number; min_watch_percentage: number | null; min_watch_seconds: number | null;
  video_card?: VideoCard | null; total_watch_seconds?: number; required_watch_seconds?: number | null;
  watched_percentage?: number | null; completion_percentage?: number | null; is_met?: boolean;
};
export type PageInfo = { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
export type Listing<T> = { items: T[]; pagination: PageInfo };
export const resourcePaths = { quizzes: '', questions: '/questions', categories: '/question-categories' };
export type Resource = keyof typeof resourcePaths;
export function resourcePermission(resource: Resource, action: string) { return `${resource === 'categories' ? 'question_categories' : resource}.${action}`; }
export const typeLabels = { single_choice: 'quizSingleChoice', multiple_choice: 'quizMultipleChoice', matching: 'quizMatching' };
