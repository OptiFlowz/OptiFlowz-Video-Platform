import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { fetchFn } from "~/API";
import { ArrowSVG, CloseSVG, IconChevron, QuizSVG } from "~/constants";
import { appendFromQuizParam, getToken, QUIZ_RETURN_PATH_STORAGE_KEY } from "~/functions";
import { useI18n } from "~/i18n";

type TranslateFn = ReturnType<typeof useI18n>["t"];

type QuizQuestionType = "single" | "multiple" | "match";

type QuizOption = {
  id: string;
  label: string;
};

type QuizBaseQuestion = {
  id: string;
  attemptQuestionId: string;
  prompt: string;
  explanation: string;
  type: QuizQuestionType;
};

type SingleOrMultipleQuestion = QuizBaseQuestion & {
  type: "single" | "multiple";
  options: QuizOption[];
};

type MatchPair = {
  id: string;
  label: string;
};

type MatchQuestion = QuizBaseQuestion & {
  type: "match";
  choices: QuizOption[];
  pairs: Array<MatchPair & { correctChoiceId: string }>;
};

type QuizQuestion = SingleOrMultipleQuestion | MatchQuestion;

type AttemptRecord = {
  id: string;
  attempt_number: number;
  status: "in_progress" | "submitted" | "expired" | string;
  score_points: number | string | null;
  max_points: number | string | null;
  score_percentage: number | string | null;
  passed: boolean | null;
  started_at: string;
  submitted_at: string | null;
  expires_at: string | null;
  answer_review_mode: "immediate" | "at_end" | "attempt_review" | string;
};

type AttemptQuestionResult = {
  questionId: string;
  prompt: string;
  answerSummary: string;
  isAnswered: boolean;
  isCorrect: boolean | null;
  reviewStatus: "correct" | "partial" | "incorrect" | null;
  scoreSummary: string;
  correctAnswerSummary: string;
  correctAnswerPairs: CorrectAnswerPair[];
  explanation: string;
};

type AttemptResult = {
  score: number | string | null;
  total: number | string | null;
  percentage: number | string | null;
  passed: boolean | null;
  attemptNumber: number;
  questionResults: AttemptQuestionResult[];
};

type ExplanationLink = {
  label: string;
  url: string;
};

type CorrectAnswerPair = {
  left: string;
  right: string;
};

type QuizAnswers = Record<string, string | string[] | Record<string, string>>;

const DEFAULT_QUIZ_TIME_LIMIT_SECONDS = 15 * 60;
const QUIZ_LOW_TIME_AUTOSAVE_SECONDS = 5;

type VideoQuizSummary = {
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

type QuizRequirementsStatus = {
  success: boolean;
  hasMetRequirements?: boolean;
};

type QuizRequirementVideo = {
  id: string;
  title: string;
  thumbnail_url?: string | null;
  duration_seconds?: number | string | null;
  view_count?: number | string | null;
  uploader_name?: string | null;
  progress_seconds?: number | string | null;
  total_watch_seconds?: number | string | null;
  percentage_watched?: number | string | null;
  requirement_percentage_watched?: number | string | null;
  rule_type?: string | null;
  required_percentage?: number | string | null;
  required_seconds?: number | string | null;
  missing_percentage?: number | string | null;
  missing_seconds?: number | string | null;
  has_met_requirement?: boolean;
};

type AttemptQuizOption = {
  id: string;
  option_text: string;
  position: number;
  selected?: boolean;
};

type AttemptQuizMatchLeftItem = {
  id: string;
  left_text: string;
  position: number;
};

type AttemptQuizMatchRightItem = {
  id: string;
  right_text: string;
  position: number;
};

type AttemptSelectedPair = {
  left_pair_id?: string;
  right_pair_id?: string;
  left_item_id?: string;
  right_item_id?: string;
  left_id?: string;
  right_id?: string;
};

type AttemptQuizQuestion = {
  attempt_question_id: string;
  attempt_id: string;
  question_id: string;
  attempt_position: number;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "matching";
  points: number;
  video_id: string | null;
  playlist_id: string | null;
  selected_option_ids?: string[];
  selected_pairs?: AttemptSelectedPair[];
  options?: AttemptQuizOption[];
  left_items?: AttemptQuizMatchLeftItem[];
  right_items?: AttemptQuizMatchRightItem[];
  review?: SaveAnswerReview | null;
  result?: "correct" | "incorrect" | "partial" | string;
  awarded_points?: number | string;
  max_points?: number | string;
  correct_option_ids?: string[];
  correct_pairs?: AttemptSelectedPair[];
  explanation?: string | null;
};

type SaveAnswerReview = {
  result?: "correct" | "incorrect" | "partial" | string;
  awarded_points?: number | string;
  max_points?: number | string;
  correct_option_ids?: string[];
  correct_pairs?: AttemptSelectedPair[];
  selected_option_ids?: string[];
  explanation?: string | null;
};

type SaveAnswerResponse = {
  success: boolean;
  saved?: boolean;
  review?: SaveAnswerReview | null;
  score?: {
    score_points?: number | string | null;
    score_percentage?: number | string | null;
  };
};

type SubmitAttemptResponse = {
  success: boolean;
  attempt: AttemptRecord;
};

type SaveDirtyAnswersResult = {
  latestSaveResponse: SaveAnswerResponse | null;
  failed: boolean;
};

function formatTime(secondsLeft: number) {
  const safeSeconds = Math.max(0, secondsLeft);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatQuizTimeLimitLabel(seconds: number, t: TranslateFn) {
  const totalMinutes = Math.max(1, Math.round(Math.max(0, seconds) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (hours > 0) {
    const hourLabel = t(hours === 1 ? "quizHour" : "quizHours", { count: hours });
    return remainingMinutes > 0 ? `${hourLabel} ${t("quizMinutesShort", { count: remainingMinutes })}` : hourLabel;
  }

  return t(totalMinutes === 1 ? "quizMinute" : "quizMinutes", { count: totalMinutes });
}

function formatDurationLabel(value: QuizRequirementVideo["duration_seconds"]) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds <= 0) return "";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getRequirementProgressText(video: QuizRequirementVideo, t: TranslateFn) {
  const watchedPercentage = Number(video.percentage_watched);
  const requirementWatchedPercentage = Number(video.requirement_percentage_watched);
  const requiredPercentage = Number(video.required_percentage);
  const totalWatchSeconds = Number(video.total_watch_seconds);
  const requiredSeconds = Number(video.required_seconds);

  if (video.rule_type === "video_watch_percentage" && Number.isFinite(requiredPercentage) && requiredPercentage > 0) {
    const watched = Number.isFinite(requirementWatchedPercentage) ? Math.round(requirementWatchedPercentage) : 0;
    return t("quizRequirementPercentProgress", { watched, required: Math.round(requiredPercentage) });
  }

  if (video.rule_type === "video_watch_seconds" && Number.isFinite(requiredSeconds) && requiredSeconds > 0) {
    const watched = Number.isFinite(totalWatchSeconds) ? Math.round(totalWatchSeconds) : 0;
    return t("quizRequirementTimeProgress", { watched: formatTime(watched), required: formatTime(Math.round(requiredSeconds)) });
  }

  if (Number.isFinite(watchedPercentage)) {
    return t("quizRequirementWatchedPercent", { watched: Math.round(watchedPercentage) });
  }

  return t("quizWatchRequirement");
}

function mapAttemptQuestion(question: AttemptQuizQuestion): QuizQuestion {
  if (question.question_type === "matching") {
    const leftItems = question.left_items ?? [];
    const rightItems = question.right_items ?? [];

    const choices = rightItems.map((item) => ({
      id: item.id,
      label: item.right_text,
    }));

    return {
      id: question.question_id,
      attemptQuestionId: question.attempt_question_id,
      prompt: question.question_text,
      explanation: "",
      type: "match",
      choices,
      pairs: leftItems.map((item) => ({
        id: item.id,
        label: item.left_text,
        correctChoiceId: item.id,
      })),
    };
  }

  const options = question.options ?? [];

  return {
    id: question.question_id,
    attemptQuestionId: question.attempt_question_id,
    prompt: question.question_text,
    explanation: "",
    type: question.question_type === "multiple_choice" ? "multiple" : "single",
    options: options.map((option) => ({
      id: option.id,
      label: option.option_text,
    })),
  };
}

function buildInitialAnswers(questions: AttemptQuizQuestion[]): QuizAnswers {
  return questions.reduce<QuizAnswers>((nextAnswers, question) => {
    if (question.question_type === "matching") {
      const selectedPairs = Array.isArray(question.selected_pairs) ? question.selected_pairs : [];
      const selectedMap = selectedPairs.reduce<Record<string, string>>((map, pair) => {
        const leftId = pair.left_pair_id ?? pair.left_item_id ?? pair.left_id;
        const rightId = pair.right_pair_id ?? pair.right_item_id ?? pair.right_id;
        if (leftId && rightId) {
          map[leftId] = rightId;
        }
        return map;
      }, {});

      if (Object.keys(selectedMap).length > 0) {
        nextAnswers[question.question_id] = selectedMap;
      }

      return nextAnswers;
    }

    const selectedOptionIds =
      question.selected_option_ids ??
      (question.options ?? [])
        .filter((option) => option.selected)
        .map((option) => option.id);

    if (question.question_type === "single_choice") {
      if (selectedOptionIds[0]) {
        nextAnswers[question.question_id] = selectedOptionIds[0];
      }
      return nextAnswers;
    }

    if (selectedOptionIds.length > 0) {
      nextAnswers[question.question_id] = selectedOptionIds;
    }

    return nextAnswers;
  }, {});
}

function getQuestionReview(question: AttemptQuizQuestion): SaveAnswerReview | null {
  if (question.review) return question.review;
  if (!question.result && question.awarded_points == null && !question.correct_option_ids && !question.correct_pairs) {
    return null;
  }

  return {
    result: question.result,
    awarded_points: question.awarded_points,
    max_points: question.max_points ?? question.points,
    correct_option_ids: question.correct_option_ids,
    correct_pairs: question.correct_pairs,
    selected_option_ids: question.selected_option_ids,
    explanation: question.explanation,
  };
}

function buildQuestionReviews(questions: AttemptQuizQuestion[]) {
  return questions.reduce<Record<string, SaveAnswerReview>>((reviews, question) => {
    const review = getQuestionReview(question);
    if (review) {
      reviews[question.question_id] = review;
    }
    return reviews;
  }, {});
}

function isQuestionAnswered(question: QuizQuestion, answer: QuizAnswers[string]) {
  if (!answer) return false;

  if (question.type === "single") {
    return typeof answer === "string" && answer.length > 0;
  }

  if (question.type === "multiple") {
    return Array.isArray(answer) && answer.length > 0;
  }

  if (question.type !== "match") return false;

  if (typeof answer !== "object" || Array.isArray(answer)) return false;
  return question.pairs.every((pair) => typeof answer[pair.id] === "string" && answer[pair.id].length > 0);
}

function getAnswerSummary(question: QuizQuestion, answer: QuizAnswers[string], t: TranslateFn) {
  if (!answer) return t("quizNotAnsweredYet");

  if (question.type === "single") {
    const option = question.options.find((item) => item.id === answer);
    return option ? t("quizAnsweredValue", { value: option.label }) : t("quizNotAnsweredYet");
  }

  if (question.type === "multiple") {
    if (!Array.isArray(answer) || answer.length === 0) {
      return t("quizNotAnsweredYet");
    }

    const selected = question.options
      .filter((item) => answer.includes(item.id))
      .map((item) => item.label);

    return selected.length > 0 ? t("quizAnsweredValue", { value: selected.join(", ") }) : t("quizNotAnsweredYet");
  }

  if (typeof answer !== "object" || Array.isArray(answer)) {
    return t("quizNotAnsweredYet");
  }

  if (question.type !== "match") {
    return t("quizNotAnsweredYet");
  }

  const matched = question.pairs
    .map((pair) => {
      const choice = question.choices.find((item) => item.id === answer[pair.id]);
      return choice ? `${pair.label}: ${choice.label}` : null;
    })
    .filter(Boolean);

  return matched.length > 0 ? t("quizAnsweredValue", { value: matched.join(" • ") }) : t("quizNotAnsweredYet");
}

function getAnsweredSummaryText(answerSummary: string) {
  return answerSummary;
}

function getAttemptScoreText(attempt: AttemptRecord) {
  const score = attempt.score_points ?? "-";
  const total = attempt.max_points ?? "-";
  return `${score}/${total}`;
}

function getReviewStatus(review: SaveAnswerReview | null | undefined): "correct" | "partial" | "incorrect" | null {
  if (!review?.result) return null;
  if (review.result === "correct" || review.result === "partial" || review.result === "incorrect") {
    return review.result;
  }
  return "incorrect";
}

function getReviewIsCorrect(review: SaveAnswerReview | null | undefined) {
  return getReviewStatus(review) === "correct";
}

function getCorrectAnswerSummary(question: QuizQuestion, review: SaveAnswerReview | null | undefined) {
  if (!review) return "";

  if (question.type === "match") {
    const summary = getCorrectAnswerPairs(question, review).map((pair) => `${pair.left}: ${pair.right}`);
    return summary.length > 0 ? summary.join(" • ") : "";
  }

  const correctOptionIds = review.correct_option_ids ?? [];
  const summary = question.options
    .filter((option) => correctOptionIds.includes(option.id))
    .map((option) => option.label);

  return summary.length > 0 ? summary.join(", ") : "";
}

function getCorrectAnswerPairs(question: QuizQuestion, review: SaveAnswerReview | null | undefined): CorrectAnswerPair[] {
  if (!review || question.type !== "match") return [];

  return (review.correct_pairs ?? [])
    .map((pair) => {
      const leftId = pair.left_pair_id ?? pair.left_item_id ?? pair.left_id;
      const rightId = pair.right_pair_id ?? pair.right_item_id ?? pair.right_id;
      const left = question.pairs.find((item) => item.id === leftId);
      const right = question.choices.find((item) => item.id === rightId);

      return left && right ? { left: left.label, right: right.label } : null;
    })
    .filter((pair): pair is CorrectAnswerPair => Boolean(pair));
}

function getReviewScoreSummary(review: SaveAnswerReview | null | undefined, t: TranslateFn) {
  if (!review) return "";
  return t("quizPointsScore", { score: review.awarded_points ?? 0, total: review.max_points ?? "-" });
}

function getReviewStatusLabel(status: "correct" | "partial" | "incorrect" | null, t: TranslateFn) {
  if (status === "correct") return t("quizCorrect");
  if (status === "partial") return t("quizPartiallyCorrect");
  if (status === "incorrect") return t("quizIncorrect");
  return t("quizNotChecked");
}

function parseExplanation(explanation: string, t: TranslateFn) {
  const links: ExplanationLink[] = [];
  const textParts: string[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(explanation)) !== null) {
    if (match.index > lastIndex) {
      textParts.push(explanation.slice(lastIndex, match.index));
    }

    links.push({
      label: match[1].trim() || t("quizExplanation"),
      url: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < explanation.length) {
    textParts.push(explanation.slice(lastIndex));
  }

  return {
    text: textParts.join(" ").replace(/\s+/g, " ").trim(),
    links,
  };
}

function QuizExplanation({ explanation, t }: { explanation?: string | null; t: TranslateFn }) {
  const normalizedExplanation = explanation?.trim();
  if (!normalizedExplanation) return null;

  const { text, links } = parseExplanation(normalizedExplanation, t);
  const getExplanationLinkLabel = (label: string) =>
    label.toLowerCase() === "explanation" ? t("quizWatchExplanationSegment") : label;
  const handleExplanationLinkClick = () => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(
        QUIZ_RETURN_PATH_STORAGE_KEY,
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    } catch {
      // The video page can still fall back to browser history if storage is unavailable.
    }
  };

  return (
    <div className="videoQuizExplanation">
      {text || links.length > 0 ? (
        <p>
          {text}
          {links.map((link, index) => (
            <span key={`${link.url}-${index}`}>
              {text || index > 0 ? " " : ""}
              {index > 0 ? "• " : ""}
              <a href={appendFromQuizParam(link.url)} target="_blank" rel="noopener noreferrer" onClick={handleExplanationLinkClick}>
                {getExplanationLinkLabel(link.label)}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function QuizCorrectAnswer({
  summary,
  pairs,
  t,
}: {
  summary: string;
  pairs?: CorrectAnswerPair[];
  t: TranslateFn;
}) {
  const matchingPairs = pairs ?? [];

  if (matchingPairs.length > 0) {
    return (
      <div className="videoQuizCorrectAnswerBlock">
        <span className="videoQuizCorrectAnswerLabel">{t("quizCorrectMatches")}</span>
        {matchingPairs.map((pair, index) => (
          <span className="videoQuizCorrectAnswerPair" key={`${pair.left}-${pair.right}-${index}`}>
            <span className="videoQuizCorrectAnswerPrompt">{pair.left}</span>
            <span className="videoQuizCorrectAnswerConnector" aria-hidden="true">→</span>
            <span className="videoQuizCorrectAnswerValue">{pair.right}</span>
          </span>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  return <p className="videoQuizCorrectAnswer">{t("quizCorrectAnswerValue", { value: summary })}</p>;
}

function buildQuestionResults(
  questions: QuizQuestion[],
  answers: QuizAnswers,
  questionReviews: Record<string, SaveAnswerReview>,
  t: TranslateFn
) {
  return questions.map((question) => {
    const answer = answers[question.id];
    const review = questionReviews[question.id];
    const reviewStatus = getReviewStatus(review);
    return {
      questionId: question.id,
      prompt: question.prompt,
      answerSummary: getAnswerSummary(question, answer, t),
      isAnswered: isQuestionAnswered(question, answer),
      isCorrect: reviewStatus ? reviewStatus === "correct" : null,
      reviewStatus,
      scoreSummary: getReviewScoreSummary(review, t),
      correctAnswerSummary: getCorrectAnswerSummary(question, review),
      correctAnswerPairs: getCorrectAnswerPairs(question, review),
      explanation: review?.explanation ?? question.explanation,
    };
  });
}

function buildAnswerPayload(question: QuizQuestion, answer: QuizAnswers[string]) {
  if (question.type === "match") {
    const selectedMap =
      answer && typeof answer === "object" && !Array.isArray(answer)
        ? answer
        : {};

    return {
      pairs: question.pairs
        .map((pair) => ({
          left_pair_id: pair.id,
          right_pair_id: selectedMap[pair.id],
        }))
        .filter((pair) => Boolean(pair.right_pair_id)),
    };
  }

  if (question.type === "single") {
    return {
      option_ids: typeof answer === "string" && answer ? [answer] : [],
    };
  }

  return {
    option_ids: Array.isArray(answer) ? answer : [],
  };
}

function QuizStatusIcon({ passed, status }: { passed?: boolean; status?: "correct" | "partial" | "incorrect" | "in_progress" | null }) {
  const iconStatus = status ?? (typeof passed === "boolean" ? (passed ? "correct" : "incorrect") : "not_checked");

  return (
    <span className={`videoQuizStatusIcon ${iconStatus === "correct" ? "passed" : iconStatus}`}>
      <svg viewBox="0 0 24 24" fill="none">
        {iconStatus === "correct" ? (
          <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ) : iconStatus === "partial" ? (
          <path d="M7 12H17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        ) : iconStatus === "in_progress" ? (
          <>
            <path d="M12 7V12L15.5 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 12A8 8 0 1 1 4 12A8 8 0 0 1 20 12Z" stroke="currentColor" strokeWidth="2.2" />
          </>
        ) : iconStatus === "not_checked" ? (
          <path d="M7 12H17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        ) : (
          <>
            <path d="M8 8L16 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M16 8L8 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}

function AnimatedTimer({ secondsLeft }: { secondsLeft: number }) {
  const value = formatTime(secondsLeft);

  return (
    <strong className="videoQuizTimerValue" aria-label={value}>
      {value.split("").map((char, index) => (
        <span
          key={`${index}-${char}`}
          className={`videoQuizTimerSlot ${char === ":" ? "separator" : ""}`}
          aria-hidden="true"
        >
          <span className="videoQuizTimerDigit">{char}</span>
        </span>
      ))}
    </strong>
  );
}

function VideoQuizPage() {
  const { t } = useI18n();
  const { quizId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<"intro" | "question" | "review" | "results">("intro");
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_QUIZ_TIME_LIMIT_SECONDS);
  const [latestResult, setLatestResult] = useState<AttemptResult | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<AttemptRecord | null>(null);
  const [questionReviews, setQuestionReviews] = useState<Record<string, SaveAnswerReview>>({});
  const [dirtyQuestionIds, setDirtyQuestionIds] = useState<Set<string>>(() => new Set());
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [isStartingAttempt, setIsStartingAttempt] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [quizFlowError, setQuizFlowError] = useState("");
  const [areRequirementsOpen, setAreRequirementsOpen] = useState(false);
  const [questionMotionDirection, setQuestionMotionDirection] = useState<"forward" | "backward">("forward");
  const pageRef = useRef<HTMLDivElement | null>(null);
  const finishAttemptRef = useRef<() => void>(() => {});
  const saveDirtyAnswersRef = useRef<() => void>(() => {});
  const dirtyAnswersSavePromiseRef = useRef<Promise<SaveDirtyAnswersResult> | null>(null);
  const requestHeaders = useMemo(() => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    const token = getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  }, []);
  const fetchAttemptQuestions = (attemptId: string) =>
    fetchFn<{
      success: boolean;
      attempt?: AttemptRecord;
      questions: AttemptQuizQuestion[];
    }>({
      route: `api/quizzes/attempt/${attemptId}/questions`,
      options: {
        method: "GET",
        headers: requestHeaders,
      },
    });

  const { data: quizSummary, isLoading: isQuizSummaryLoading } = useQuery({
    queryKey: ["quiz-page-summary", quizId],
    queryFn: () =>
      fetchFn<{ success: boolean; quiz?: VideoQuizSummary }>({
        route: `api/quizzes/${quizId}/details`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      })
        .then((response) => response.quiz ?? null)
        .catch((error: { status?: number }) => {
          if (error?.status && error.status !== 404) {
            throw error;
          }

          return fetchFn<{ success: boolean; quiz?: VideoQuizSummary }>({
            route: `api/quizzes/${quizId}`,
            options: {
              method: "GET",
              headers: requestHeaders,
            },
          })
            .then((response) => response.quiz ?? null)
            .catch((fallbackError: { status?: number }) => {
              if (fallbackError?.status === 404) return null;
              throw fallbackError;
            });
        }),
    enabled: !!quizId,
    refetchOnWindowFocus: false,
  });

  const { data: attempts = [], isLoading: areAttemptsLoading } = useQuery({
    queryKey: ["quiz-page-attempts", quizId],
    queryFn: () =>
      fetchFn<{ success: boolean; attempts: AttemptRecord[] }>({
        route: `api/quizzes/${quizId}/attempts`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }).then((response) => response.attempts ?? []),
    enabled: !!quizId,
    refetchOnWindowFocus: false,
  });

  const {
    data: requirementsStatus,
    isLoading: areRequirementsLoading,
    isError: hasRequirementsStatusError,
  } = useQuery({
    queryKey: ["quiz-page-requirements", quizId],
    queryFn: () =>
      fetchFn<QuizRequirementsStatus>({
        route: `api/quizzes/${quizId}/requirements`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }),
    enabled: !!quizId,
    refetchOnWindowFocus: false,
  });

  const {
    data: requirementVideos = [],
    isLoading: areRequirementVideosLoading,
    isError: hasRequirementVideosError,
  } = useQuery({
    queryKey: ["quiz-page-requirement-videos", quizId],
    queryFn: () =>
      fetchFn<{ success: boolean; requirements?: QuizRequirementVideo[] }>({
        route: `api/quizzes/${quizId}/requirements/videos`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }).then((response) => response.requirements ?? []),
    enabled: !!quizId && areRequirementsOpen,
    refetchOnWindowFocus: false,
  });

  const { data: attemptQuestions = [], isLoading: areQuestionsLoading } = useQuery({
    queryKey: ["quiz-page-attempt-questions", activeAttempt?.id],
    queryFn: () =>
      fetchAttemptQuestions(activeAttempt!.id).then((response) => {
        const nextAttempt = response.attempt ?? activeAttempt!;
        if (response.attempt) {
          setActiveAttempt(nextAttempt);
        }
        const nextReviewMode = nextAttempt.answer_review_mode ?? "immediate";
        const canRevealReviews = nextAttempt.status !== "in_progress" || nextReviewMode === "immediate";
        setAnswers(buildInitialAnswers(response.questions ?? []));
        setQuestionReviews(canRevealReviews ? buildQuestionReviews(response.questions ?? []) : {});
        setDirtyQuestionIds(new Set());
        return response.questions ?? [];
      }),
    enabled: !!activeAttempt?.id && stage !== "intro" && stage !== "results",
    refetchOnWindowFocus: false,
  });

  const questions = useMemo(
    () =>
      [...attemptQuestions]
        .sort((a, b) => Number(a.attempt_position || 0) - Number(b.attempt_position || 0))
        .map(mapAttemptQuestion),
    [attemptQuestions]
  );
  const quizTimeLimitSeconds = Math.max(1, Number(quizSummary?.time_limit_seconds) || DEFAULT_QUIZ_TIME_LIMIT_SECONDS);
  const quizMaxAttempts = Math.max(0, Number(quizSummary?.max_attempts) || 0);
  const summaryQuestionCount = Math.max(0, Number(quizSummary?.question_count) || 0);
  const displayedQuestionCount = stage === "intro" ? summaryQuestionCount : questions.length || summaryQuestionCount;
  const quizDisplayTitle = quizSummary?.title || t("quizDefaultTitle");
  const attemptsLeft = Math.max(0, quizMaxAttempts - attempts.length);
  const hasMetQuizRequirements = requirementsStatus?.hasMetRequirements === true;
  const isRequirementsBlocking = requirementsStatus?.hasMetRequirements === false;
  const answeredCount = questions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
  const currentQuestion = questions[currentQuestionIndex];
  const hasQuizQuestions = stage === "intro" ? summaryQuestionCount > 0 : questions.length > 0;
  const selectedActiveAttempt = useMemo(
    () => attempts.find((attempt) => attempt.status === "in_progress") ?? null,
    [attempts]
  );
  const activeReviewMode = activeAttempt?.answer_review_mode ?? selectedActiveAttempt?.answer_review_mode ?? "immediate";
  const isImmediateReview = activeReviewMode === "immediate";
  const isDeferredReview = activeReviewMode === "at_end" || activeReviewMode === "attempt_review";
  const isReadOnlyAttempt = Boolean(activeAttempt && activeAttempt.status !== "in_progress");
  const currentQuestionReview = currentQuestion ? questionReviews[currentQuestion.id] : undefined;
  const isQuizLoading = isQuizSummaryLoading || areAttemptsLoading || (stage !== "intro" && areQuestionsLoading);
  const summaryQuestionResults = useMemo(
    () => buildQuestionResults(questions, answers, questionReviews, t),
    [answers, questionReviews, questions, t]
  );

  useEffect(() => {
    setStage("intro");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setDeadline(null);
    setSecondsLeft(quizTimeLimitSeconds);
    setLatestResult(null);
    setActiveAttempt(null);
    setQuestionReviews({});
    setDirtyQuestionIds(new Set());
    setIsSubmittingAttempt(false);
    setQuizFlowError("");
    setAreRequirementsOpen(false);
  }, [quizId, quizTimeLimitSeconds]);

  useEffect(() => {
    if (!deadline || (stage !== "question" && stage !== "review")) return;

    const tick = () => {
      const nextSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(nextSeconds);

      if (nextSeconds > 0 && nextSeconds <= QUIZ_LOW_TIME_AUTOSAVE_SECONDS) {
        saveDirtyAnswersRef.current();
      }

      if (nextSeconds <= 0) {
        finishAttemptRef.current();
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [deadline, stage]);

  useEffect(() => {
    requestAnimationFrame(() => pageRef.current?.focus());
  }, [stage]);

  const handleExit = () => {
    if (stage !== "intro") {
      setStage("intro");
      setDeadline(null);
      return;
    }

    navigate("/");
  };

  const beginAttemptFlow = (attempt: AttemptRecord) => {
    const expiresAt = attempt.expires_at ? new Date(attempt.expires_at).getTime() : Date.now() + quizTimeLimitSeconds * 1000;
    const nextSecondsLeft = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

    setActiveAttempt(attempt);
    setQuestionMotionDirection("forward");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setLatestResult(null);
    setQuestionReviews({});
    setDirtyQuestionIds(new Set());
    setQuizFlowError("");
    setStage("question");
    setDeadline(Date.now() + nextSecondsLeft * 1000);
    setSecondsLeft(nextSecondsLeft);
  };

  const startAttempt = async () => {
    if ((quizMaxAttempts > 0 && attemptsLeft <= 0) || !quizSummary || isStartingAttempt || isRequirementsBlocking) {
      if (isRequirementsBlocking) {
        setAreRequirementsOpen(true);
        setQuizFlowError(t("quizCompleteRequirementsBeforeStarting"));
      }
      return;
    }

    setIsStartingAttempt(true);
    setQuizFlowError("");

    try {
      const response = await fetchFn<{ success: boolean; attempt: AttemptRecord }>({
        route: `api/quizzes/${quizSummary.id}/attempt/start`,
        options: {
          method: "POST",
          headers: requestHeaders,
        },
      });

      await queryClient.invalidateQueries({ queryKey: ["quiz-page-attempts", quizId] });
      beginAttemptFlow(response.attempt);
    } catch (error) {
      setQuizFlowError(error instanceof Error ? error.message : t("quizFailedStartAttempt"));
    } finally {
      setIsStartingAttempt(false);
    }
  };

  const viewAttempt = (attempt: AttemptRecord) => {
    setActiveAttempt(attempt);
    setQuestionMotionDirection("forward");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setLatestResult(null);
    setQuestionReviews({});
    setDirtyQuestionIds(new Set());
    setQuizFlowError("");
    setDeadline(null);
    setSecondsLeft(0);
    setStage("review");
  };

  const saveAnswerForQuestion = async (question: QuizQuestion) => {
    if (!activeAttempt || savingQuestionId || isReadOnlyAttempt) return null;

    const payload = buildAnswerPayload(question, answers[question.id]);
    setSavingQuestionId(question.id);
    setQuizFlowError("");

    try {
      const response = await fetchFn<SaveAnswerResponse>({
        route: `api/quizzes/attempt/${activeAttempt.id}/question/${question.id}/answer`,
        options: {
          method: "PUT",
          headers: requestHeaders,
          body: JSON.stringify({ answer: payload }),
        },
      });

      if (response.review && isImmediateReview) {
        setQuestionReviews((current) => ({
          ...current,
          [question.id]: response.review!,
        }));
      }

      setDirtyQuestionIds((current) => {
        const next = new Set(current);
        next.delete(question.id);
        return next;
      });

      return response;
    } catch (error) {
      setQuizFlowError(error instanceof Error ? error.message : t("quizFailedSaveAnswer"));
      return null;
    } finally {
      setSavingQuestionId(null);
    }
  };

  const saveCurrentAnswer = async () => {
    if (!currentQuestion) return null;
    return saveAnswerForQuestion(currentQuestion);
  };

  const moveToQuestion = (nextIndex: number) => {
    setQuestionMotionDirection(nextIndex >= currentQuestionIndex ? "forward" : "backward");
    setCurrentQuestionIndex(nextIndex);
    setStage("question");
  };

  const handleNextQuestion = async () => {
    if (!currentQuestion) return;

    if (isReadOnlyAttempt) {
      moveToQuestion(Math.min(questions.length - 1, currentQuestionIndex + 1));
      return;
    }

    if (isImmediateReview && currentQuestionReview) {
      moveToQuestion(Math.min(questions.length - 1, currentQuestionIndex + 1));
      return;
    }

    const response = await saveCurrentAnswer();
    if (!response) return;

    if (isImmediateReview && response.review) {
      return;
    }

    moveToQuestion(Math.min(questions.length - 1, currentQuestionIndex + 1));
  };

  const handleQuestionNavigation = async (nextIndex: number) => {
    if (nextIndex === currentQuestionIndex && stage === "question") return;

    if (!isReadOnlyAttempt && stage === "question" && currentQuestion) {
      const isCurrentAnswerDirty = dirtyQuestionIds.has(currentQuestion.id);
      const hasCurrentAnswer = isQuestionAnswered(currentQuestion, answers[currentQuestion.id]);

      if (isCurrentAnswerDirty && hasCurrentAnswer) {
        const response = await saveCurrentAnswer();
        if (!response) return;
      }
    }

    moveToQuestion(nextIndex);
  };

  const handleOpenReview = async () => {
    if (!isReadOnlyAttempt && stage === "question" && currentQuestion) {
      const isCurrentAnswerDirty = dirtyQuestionIds.has(currentQuestion.id);
      const hasCurrentAnswer = isQuestionAnswered(currentQuestion, answers[currentQuestion.id]);

      if (isCurrentAnswerDirty && hasCurrentAnswer) {
        const response = await saveCurrentAnswer();
        if (!response) return;
      }
    }

    setStage("review");
  };

  const handleLastQuestionAction = async () => {
    if (isReadOnlyAttempt) {
      await handleOpenReview();
      return;
    }

    if (isImmediateReview && !currentQuestionReview) {
      await saveCurrentAnswer();
      return;
    }

    await handleOpenReview();
  };

  const saveDirtyAnswers = () => {
    if (dirtyAnswersSavePromiseRef.current) {
      return dirtyAnswersSavePromiseRef.current;
    }

    const savePromise = (async (): Promise<SaveDirtyAnswersResult> => {
      if (!activeAttempt) {
        return { latestSaveResponse: null, failed: false };
      }

      const dirtyQuestions = questions.filter(
        (question) => dirtyQuestionIds.has(question.id) && isQuestionAnswered(question, answers[question.id])
      );
      let latestSaveResponse: SaveAnswerResponse | null = null;

      for (const question of dirtyQuestions) {
        const response = await saveAnswerForQuestion(question);
        if (!response) {
          return { latestSaveResponse, failed: true };
        }
        latestSaveResponse = response;
      }

      return { latestSaveResponse, failed: false };
    })();

    dirtyAnswersSavePromiseRef.current = savePromise;
    savePromise.finally(() => {
      if (dirtyAnswersSavePromiseRef.current === savePromise) {
        dirtyAnswersSavePromiseRef.current = null;
      }
    });

    return savePromise;
  };

  const finishAttempt = async () => {
    if (!activeAttempt || isSubmittingAttempt) return;

    setIsSubmittingAttempt(true);
    setQuizFlowError("");

    try {
      let latestSaveResponse: SaveAnswerResponse | null = null;
      const pendingSave = dirtyAnswersSavePromiseRef.current;

      if (pendingSave) {
        const pendingResult = await pendingSave;
        latestSaveResponse = pendingResult.latestSaveResponse;

        if (pendingResult.failed) {
          setIsSubmittingAttempt(false);
          return;
        }
      }

      const { latestSaveResponse: finalSaveResponse, failed } = await saveDirtyAnswers();
      latestSaveResponse = finalSaveResponse ?? latestSaveResponse;

      if (failed) {
        setIsSubmittingAttempt(false);
        return;
      }

      const submitResponse = await fetchFn<SubmitAttemptResponse>({
        route: `api/quizzes/attempt/${activeAttempt.id}/submit`,
        options: {
          method: "POST",
          headers: requestHeaders,
        },
      });
      const submittedAttempt = submitResponse.attempt;
      const submittedQuestionsResponse = await fetchAttemptQuestions(activeAttempt.id);
      const submittedQuestions = submittedQuestionsResponse.questions ?? [];
      const submittedAnswers = buildInitialAnswers(submittedQuestions);
      const submittedQuestionReviews = buildQuestionReviews(submittedQuestions);
      const submittedQuizQuestions = [...submittedQuestions]
        .sort((a, b) => Number(a.attempt_position || 0) - Number(b.attempt_position || 0))
        .map(mapAttemptQuestion);
      const refreshedAttempt = submittedQuestionsResponse.attempt ?? submittedAttempt;

      setActiveAttempt(refreshedAttempt);
      setAnswers(submittedAnswers);
      setQuestionReviews(submittedQuestionReviews);
      setDeadline(null);
      queryClient.setQueryData(["quiz-page-attempt-questions", activeAttempt.id], submittedQuestions);

      setLatestResult({
        score: refreshedAttempt.score_points ?? latestSaveResponse?.score?.score_points ?? null,
        total: refreshedAttempt.max_points ?? submittedQuizQuestions.length,
        percentage: refreshedAttempt.score_percentage ?? latestSaveResponse?.score?.score_percentage ?? null,
        passed: refreshedAttempt.passed,
        attemptNumber: refreshedAttempt.attempt_number,
        questionResults: buildQuestionResults(submittedQuizQuestions, submittedAnswers, submittedQuestionReviews, t),
      });
      setDirtyQuestionIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["quiz-page-attempts", quizId] });
      setStage("results");
    } catch (error) {
      setQuizFlowError(error instanceof Error ? error.message : t("quizFailedSubmitAttempt"));
    } finally {
      setIsSubmittingAttempt(false);
    }
  };

  const finishAttemptAction = () => {
    void finishAttempt();
  };

  finishAttemptRef.current = () => {
    void finishAttempt();
  };

  saveDirtyAnswersRef.current = () => {
    void saveDirtyAnswers();
  };

  const saveDirtyAnswersSoonIfLowTime = () => {
    if (secondsLeft <= 0 || secondsLeft > QUIZ_LOW_TIME_AUTOSAVE_SECONDS) return;
    window.setTimeout(() => {
      const pendingSave = dirtyAnswersSavePromiseRef.current;

      if (pendingSave) {
        void pendingSave.finally(() => saveDirtyAnswersRef.current());
        return;
      }

      saveDirtyAnswersRef.current();
    }, 0);
  };

  const handleSingleChoiceSelect = (questionId: string, optionId: string) => {
    setQuestionReviews((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setDirtyQuestionIds((current) => new Set(current).add(questionId));
    setAnswers((current) => ({ ...current, [questionId]: optionId }));
    saveDirtyAnswersSoonIfLowTime();
  };

  const handleMultipleChoiceToggle = (questionId: string, optionId: string) => {
    setQuestionReviews((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setDirtyQuestionIds((current) => new Set(current).add(questionId));
    setAnswers((current) => {
      const previous = Array.isArray(current[questionId]) ? [...(current[questionId] as string[])] : [];
      const next = previous.includes(optionId)
        ? previous.filter((item) => item !== optionId)
        : [...previous, optionId];

      return { ...current, [questionId]: next };
    });
    saveDirtyAnswersSoonIfLowTime();
  };

  const handleMatchSelect = (questionId: string, pairId: string, optionId: string) => {
    setQuestionReviews((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    setDirtyQuestionIds((current) => new Set(current).add(questionId));
    setAnswers((current) => {
      const previous =
        current[questionId] && typeof current[questionId] === "object" && !Array.isArray(current[questionId])
          ? { ...(current[questionId] as Record<string, string>) }
          : {};

      return {
        ...current,
        [questionId]: {
          ...previous,
          [pairId]: optionId,
        },
      };
    });
    saveDirtyAnswersSoonIfLowTime();
  };

  const goToFirstIncomplete = () => {
    const firstIncompleteIndex = questions.findIndex((question) => !isQuestionAnswered(question, answers[question.id]));
    setQuestionMotionDirection("backward");
    setCurrentQuestionIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0);
    setStage("question");
  };

  const renderQuestionContent = () => {
    if (!currentQuestion) return null;

    if (currentQuestion.type === "match") {
      const selectedMap =
        answers[currentQuestion.id] && typeof answers[currentQuestion.id] === "object" && !Array.isArray(answers[currentQuestion.id])
          ? (answers[currentQuestion.id] as Record<string, string>)
          : {};

      return (
        <div className="videoQuizOptions">
          {currentQuestion.pairs.map((pair) => (
            <div key={pair.id} className="videoQuizMatchRow">
              <span>
                <strong>{pair.label}</strong>
              </span>

              <label className="videoQuizSelect">
                <select
                  value={selectedMap[pair.id] ?? ""}
                  disabled={isReadOnlyAttempt || Boolean(currentQuestionReview) || savingQuestionId === currentQuestion.id}
                  onChange={(event) =>
                    handleMatchSelect(currentQuestion.id, pair.id, event.target.value)
                  }
                >
                  <option value="">{t("quizChooseAnswer")}</option>
                  {currentQuestion.choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <IconChevron className="videoQuizSelectChevron" />
              </label>
            </div>
          ))}
        </div>
      );
    }

    const selectedValue = answers[currentQuestion.id];
    const selectedValues = Array.isArray(selectedValue) ? selectedValue : [];

    return (
      <div className="videoQuizOptions">
        {currentQuestion.options.map((option, optionIndex) => {
          const optionLetter = String.fromCharCode(65 + optionIndex);
          const isSelected =
            currentQuestion.type === "single"
              ? selectedValue === option.id
              : selectedValues.includes(option.id);

          return (
            <button
              type="button"
              key={option.id}
              className={`videoQuizOption ${isSelected ? "selected" : ""}`}
              disabled={isReadOnlyAttempt || Boolean(currentQuestionReview) || savingQuestionId === currentQuestion.id}
              onClick={() =>
                currentQuestion.type === "single"
                  ? handleSingleChoiceSelect(currentQuestion.id, option.id)
                  : handleMultipleChoiceToggle(currentQuestion.id, option.id)
              }
            >
              <span className={`videoQuizOptionMarker ${currentQuestion.type}`}>
                {isSelected ? (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>

              <span className="videoQuizOptionText">
                <strong>{optionLetter}</strong>
                <span>{option.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <main className="videoQuizPage">
      <div
        ref={pageRef}
        className={`videoQuizPageContent ${stage === "intro" ? "introStage" : ""} ${stage === "results" ? "resultsStage" : ""} ${stage === "question" || stage === "review" ? "flowStage" : ""}`}
        aria-label={quizDisplayTitle}
        tabIndex={-1}
      >
        <div className="videoQuizTop">
          <div className="videoQuizHeading">
            <span className="videoQuizBadge">{QuizSVG}</span>
            <span>
              <h2>{quizDisplayTitle}</h2>
              <p>
                {t("quizCertificateMeta", { count: displayedQuestionCount, time: formatQuizTimeLimitLabel(quizTimeLimitSeconds, t) })}
              </p>
            </span>
          </div>

          <div className="videoQuizTopActions">
            {(stage === "question" || stage === "review") && !isReadOnlyAttempt && (
              <span className={`videoQuizTimer ${secondsLeft <= 60 ? "urgent" : ""}`}>
                <span>{t("quizTimeLeft")}</span> <AnimatedTimer secondsLeft={secondsLeft} />
              </span>
            )}

            <button type="button" onClick={handleExit} className="videoQuizCloseButton" aria-label={t("quizCloseQuiz")}>
              {CloseSVG}
            </button>
          </div>
        </div>

        <div key={stage} className="videoQuizStageTransition">
          {stage === "intro" ? (
            <div className="videoQuizIntro">
              <div className="videoQuizSectionTitle">
                <h3>{t("quizYourLastAttempts")}</h3>
                <p>{quizMaxAttempts > 0 ? t("quizAttemptsLeft", { count: attemptsLeft }) : t("quizAttemptsAppearHere")}</p>
              </div>

              {isQuizLoading ? (
                <div className="videoQuizEmptyState">
                  <strong>{t("quizLoadingQuiz")}</strong>
                  <p>{t("quizQuestionsPreparing")}</p>
                </div>
              ) : attempts.length > 0 ? (
                <div className="videoQuizAttemptList">
                  {[...attempts].reverse().map((attempt) => (
                    <div key={attempt.id} className="videoQuizAttemptCard">
                      <QuizStatusIcon
                        status={attempt.status === "in_progress" ? "in_progress" : undefined}
                        passed={attempt.passed === true}
                      />

                      <div className="videoQuizAttemptText">
                        <strong>{t("quizAttemptNumber", { count: attempt.attempt_number })}</strong>
                        <p>
                          {attempt.status === "in_progress"
                            ? t("quizInProgress")
                            : t("quizYouScored", { score: getAttemptScoreText(attempt) })}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="videoQuizInlineButton videoQuizAttemptViewButton"
                        onClick={() => attempt.status === "in_progress" ? beginAttemptFlow(attempt) : viewAttempt(attempt)}
                        disabled={isQuizLoading}
                      >
                        {attempt.status === "in_progress" ? t("quizContinue") : t("quizView")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : !isRequirementsBlocking ? (
                <div className="videoQuizEmptyState">
                  <strong>{t("quizNoAttemptsYet")}</strong>
                  <p>{t("quizStartFirstAttempt")}</p>
                </div>
              ) : null}

              {!hasMetQuizRequirements ? (
                <div className={`videoQuizRequirementsCard ${isRequirementsBlocking ? "blocked" : ""}`}>
                  <div className="videoQuizRequirementsSummary">
                    <div>
                      <strong>{t("quizRequirements")}</strong>
                      <p>
                        {areRequirementsLoading
                          ? t("quizCheckingEligibility")
                          : hasRequirementsStatusError
                            ? t("quizCouldNotCheckRequirements")
                            : isRequirementsBlocking
                              ? t("quizCompleteRequiredVideos")
                              : t("quizOpenRequirementsHint")}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="videoQuizInlineButton"
                      onClick={() => setAreRequirementsOpen((current) => !current)}
                      disabled={areRequirementsLoading && !areRequirementsOpen}
                    >
                      {areRequirementsOpen ? t("quizHideRequirements") : t("quizViewRequirements")}
                    </button>
                  </div>

                  <div className={`videoQuizRequirementsPanel ${areRequirementsOpen ? "open" : ""}`} aria-hidden={!areRequirementsOpen}>
                      {areRequirementVideosLoading ? (
                        <div className="videoQuizEmptyState">
                          <strong>{t("quizLoadingRequirements")}</strong>
                          <p>{t("quizCheckingLinkedVideos")}</p>
                        </div>
                      ) : hasRequirementVideosError ? (
                        <div className="videoQuizUnlockNotice error">
                          <strong>{t("quizCouldNotLoadRequirements")}</strong>
                          <p>{t("quizTryOpeningRequirementsAgain")}</p>
                        </div>
                      ) : requirementVideos.length > 0 ? (
                        <div className="videoQuizRequirementList">
                          {requirementVideos.map((video) => (
                            <div key={video.id} className={`videoQuizRequirementVideo ${video.has_met_requirement ? "met" : ""}`}>
                              {video.thumbnail_url ? (
                                <img src={video.thumbnail_url} alt="" loading="lazy" decoding="async" />
                              ) : (
                                <div className="videoQuizRequirementThumbFallback" aria-hidden="true">
                                  {QuizSVG}
                                </div>
                              )}

                              <div className="videoQuizRequirementVideoText">
                                <strong>{video.title || t("quizRequiredVideo")}</strong>
                                <p>{getRequirementProgressText(video, t)}</p>
                              </div>

                              <div className="videoQuizRequirementVideoActions">
                                {formatDurationLabel(video.duration_seconds) ? (
                                  <span className="videoQuizRequirementDuration">
                                    {formatDurationLabel(video.duration_seconds)}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="videoQuizInlineButton"
                                  onClick={() => navigate(`/video/${video.id}`)}
                                >
                                  {t("quizWatch")}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="videoQuizEmptyState">
                          <strong>{t("quizNoRequirementVideos")}</strong>
                          <p>{t("quizNoRequiredVideosListed")}</p>
                        </div>
                      )}
                    </div>
                </div>
              ) : null}

              {!isQuizLoading && !quizSummary ? (
                <div className="videoQuizUnlockNotice">
                  <strong>{t("quizNoQuizAvailable")}</strong>
                  <p>{t("quizVideoNoQuizYet")}</p>
                </div>
              ) : null}

              {!isQuizLoading && quizSummary && !hasQuizQuestions ? (
                <div className="videoQuizUnlockNotice">
                  <strong>{t("quizNoQuestionsYet")}</strong>
                  <p>{t("quizQuestionsNotAddedYet")}</p>
                </div>
              ) : null}

              {quizMaxAttempts > 0 && attemptsLeft === 0 ? (
                <div className="videoQuizUnlockNotice">
                  <strong>{t("quizNoAttemptsLeft")}</strong>
                  <p>{t("quizUsedAllAttempts", { count: quizMaxAttempts })}</p>
                </div>
              ) : null}

              {quizFlowError ? (
                <div className="videoQuizUnlockNotice error">
                  <strong>{t("quizError")}</strong>
                  <p>{quizFlowError}</p>
                </div>
              ) : null}

              <div className="videoQuizFooterActions">
                <button type="button" className="videoQuizGhostButton" onClick={handleExit}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  className="videoQuizPrimaryButton"
                  onClick={startAttempt}
                  disabled={isQuizLoading || areRequirementsLoading || isStartingAttempt || !quizSummary || !hasQuizQuestions || isRequirementsBlocking || (quizMaxAttempts > 0 && attemptsLeft <= 0)}
                >
                  {isStartingAttempt ? t("quizStarting") : t("quizAttempt")} {ArrowSVG}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "question" || stage === "review" ? (
            <div className={`videoQuizShell ${stage === "review" ? "summaryShell" : ""}`}>
              {stage === "question" ? (
              <aside className="videoQuizSidebar">
                <h3>{t("quizQuestions")}</h3>
                <p>
                  {t("quizAnsweredCount", { answered: answeredCount, total: questions.length })}
                </p>

                <div className="videoQuizGrid">
                  {questions.map((question, index) => {
                    const answered = isQuestionAnswered(question, answers[question.id]);
                    const isCurrent = index === currentQuestionIndex && stage === "question";

                    return (
                      <button
                        key={question.id}
                        type="button"
                        className={`videoQuizGridButton ${answered ? "answered" : ""} ${isCurrent ? "current" : ""}`}
                        disabled={savingQuestionId === currentQuestion?.id}
                        onClick={() => handleQuestionNavigation(index)}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="videoQuizReviewLink"
                  disabled={savingQuestionId === currentQuestion?.id}
                  onClick={handleOpenReview}
                >
                  {isReadOnlyAttempt ? t("quizAttemptSummary") : t("quizFinishAttemptEllipsis")}
                </button>
              </aside>
              ) : null}

              {stage === "question" && !currentQuestion ? (
                <section className="videoQuizQuestionPanel">
                  <div className="videoQuizEmptyState">
                    <strong>{t("quizLoadingQuestions")}</strong>
                    <p>{t("quizAttemptPreparing")}</p>
                  </div>
                </section>
              ) : stage === "question" && currentQuestion ? (
                <section className="videoQuizQuestionPanel">
                  <div
                    key={currentQuestion.id}
                    className={`videoQuizQuestionTransition ${questionMotionDirection}`}
                  >
                    <div className="videoQuizQuestionHeader">
                      <span className="videoQuizQuestionNumber">{currentQuestionIndex + 1}</span>
                      <div>
                        <h3>{currentQuestion.prompt}</h3>
                        <p>{currentQuestion.type === "single" ? t("quizSingleChoice") : currentQuestion.type === "multiple" ? t("quizMultipleChoice") : t("quizMatchConcepts")}</p>
                      </div>
                    </div>

                    {renderQuestionContent()}

                    {quizFlowError ? (
                      <div className="videoQuizFeedbackCard error">
                        <strong>{t("quizCouldNotSaveAnswer")}</strong>
                        <p>{quizFlowError}</p>
                      </div>
                    ) : null}

                    {currentQuestionReview ? (
                      <div className={`videoQuizFeedbackCard ${getReviewStatus(currentQuestionReview) ?? "incorrect"}`}>
                        <strong>
                          {getReviewStatus(currentQuestionReview) === "correct"
                            ? t("quizCorrectAnswer")
                            : getReviewStatus(currentQuestionReview) === "partial"
                              ? t("quizPartiallyCorrect")
                              : t("quizNotQuiteRight")}
                        </strong>
                        <p>
                          {t("quizPointsScore", { score: currentQuestionReview.awarded_points ?? 0, total: currentQuestionReview.max_points ?? "-" })}
                        </p>
                        <QuizExplanation explanation={currentQuestionReview.explanation} t={t} />
                        <QuizCorrectAnswer
                          summary={getCorrectAnswerSummary(currentQuestion, currentQuestionReview)}
                          pairs={getCorrectAnswerPairs(currentQuestion, currentQuestionReview)}
                          t={t}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="videoQuizActionRow">
                    {currentQuestionIndex > 0 ? (
                      <button
                        type="button"
                        className="videoQuizGhostButton"
                        disabled={savingQuestionId === currentQuestion.id}
                        onClick={() => handleQuestionNavigation(Math.max(0, currentQuestionIndex - 1))}
                      >
                        {t("quizPreviousQuestion")}
                      </button>
                    ) : null}

                    {currentQuestionIndex < questions.length - 1 ? (
                      <button
                        type="button"
                        className="videoQuizPrimaryButton"
                        disabled={savingQuestionId === currentQuestion.id}
                        onClick={handleNextQuestion}
                      >
                        {savingQuestionId === currentQuestion.id
                          ? t("saving")
                          : !isReadOnlyAttempt && isImmediateReview && !currentQuestionReview
                            ? t("quizCheckAnswer")
                            : t("quizNextQuestion")} {ArrowSVG}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="videoQuizPrimaryButton"
                        disabled={savingQuestionId === currentQuestion.id}
                        onClick={() => void handleLastQuestionAction()}
                      >
                        {savingQuestionId === currentQuestion.id
                          ? t("saving")
                          : !isReadOnlyAttempt && isImmediateReview && !currentQuestionReview
                            ? t("quizCheckAnswer")
                            : t("quizReviewAttempt")} {ArrowSVG}
                      </button>
                    )}
                  </div>
                </section>
              ) : (
                <section className="videoQuizReviewPanel">
                  <h3>{isReadOnlyAttempt ? t("quizAttemptReviewTitle", { count: activeAttempt?.attempt_number ?? "" }) : t("quizAnsweredAllQuestions")}</h3>

                  <div className="videoQuizReviewList">
                    {summaryQuestionResults.map((result, index) => {
                      const shouldShowReviewDetails = isReadOnlyAttempt || !isDeferredReview;
                      return (
                        <div
                          key={result.questionId}
                          className={`videoQuizReviewCard ${
                            !shouldShowReviewDetails && !result.isAnswered ? "unanswered" : ""
                          } ${result.reviewStatus ?? ""}`}
                        >
                          {shouldShowReviewDetails ? <QuizStatusIcon status={result.reviewStatus} /> : null}

                          <div className="videoQuizReviewCardText">
                            <div className="videoQuizReviewCardTopline">
                              <strong>
                                {index + 1}. {shouldShowReviewDetails ? result.prompt : result.answerSummary}
                              </strong>
                              {shouldShowReviewDetails ? (
                                <div className="videoQuizReviewMeta">
                                  <span className={`videoQuizReviewStatus ${result.reviewStatus ?? ""}`}>
                                    {getReviewStatusLabel(result.reviewStatus, t)}
                                  </span>
                                  {result.scoreSummary ? (
                                    <span className="videoQuizScoreChip">{result.scoreSummary}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            {shouldShowReviewDetails ? (
                              <QuizCorrectAnswer
                                summary={result.correctAnswerSummary}
                                pairs={result.correctAnswerPairs}
                                t={t}
                              />
                            ) : null}
                            {shouldShowReviewDetails ? <QuizExplanation explanation={result.explanation} t={t} /> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="videoQuizActionRow">
                    <button
                      type="button"
                      className="videoQuizGhostButton"
                      onClick={isReadOnlyAttempt ? () => handleQuestionNavigation(0) : goToFirstIncomplete}
                      disabled={isSubmittingAttempt || questions.length === 0}
                    >
                      {isReadOnlyAttempt ? t("quizViewQuestions") : t("quizBackToQuiz")}
                    </button>
                    {isReadOnlyAttempt ? (
                      <button type="button" className="videoQuizPrimaryButton" onClick={() => setStage("intro")}>
                        {t("quizBackToAttempts")}
                      </button>
                    ) : (
                      <button type="button" className="videoQuizPrimaryButton" onClick={finishAttemptAction} disabled={isSubmittingAttempt}>
                        {isSubmittingAttempt ? t("quizSubmitting") : t("quizFinishAttempt")}
                      </button>
                    )}
                  </div>
                </section>
              )}
            </div>
          ) : null}

          {stage === "results" && latestResult ? (
            <div className="videoQuizResults">
              <div className="videoQuizResultHeadline">
                <h3>{latestResult.passed === true ? t("quizCongrats") : t("quizComplete")}</h3>
                <p>
                  {t("quizCurrentScore", { score: latestResult.score ?? "-", total: latestResult.total ?? "-" })}
                  {latestResult.percentage ? ` (${latestResult.percentage}%)` : ""}
                </p>
              </div>

              <div className="videoQuizResultList">
                {latestResult.questionResults.map((result, index) => (
                  <div
                    key={result.questionId}
                    className={`videoQuizResultCard ${result.reviewStatus ?? ""}`}
                  >
                    <QuizStatusIcon status={result.reviewStatus} />

                    <div className="videoQuizResultCardText">
                      <strong>
                        {index + 1}. {result.prompt}
                      </strong>

                      <p>{getAnsweredSummaryText(result.answerSummary)}</p>

                      <QuizCorrectAnswer
                        summary={result.correctAnswerSummary}
                        pairs={result.correctAnswerPairs}
                        t={t}
                      />

                      {result.isCorrect === false && result.explanation ? (
                        <QuizExplanation explanation={result.explanation} t={t} />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="videoQuizFooterActions">
                <button type="button" className="videoQuizGhostButton" onClick={handleExit}>
                  {t("quizCloseQuiz")}
                </button>
                <button
                  type="button"
                  className="videoQuizPrimaryButton"
                  onClick={startAttempt}
                  disabled={isQuizLoading || isStartingAttempt || !quizSummary || (quizMaxAttempts > 0 && attempts.length >= quizMaxAttempts)}
                >
                  {t("quizAttemptAgain")} {ArrowSVG}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default VideoQuizPage;
