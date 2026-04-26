import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchFn } from "~/API";
import { ArrowSVG, CloseSVG, IconChevron, QuizSVG } from "~/constants";
import { getToken } from "~/functions";

type QuizQuestionType = "single" | "multiple" | "match";

type QuizOption = {
  id: string;
  label: string;
};

type QuizBaseQuestion = {
  id: string;
  prompt: string;
  explanation: string;
  type: QuizQuestionType;
};

type SingleOrMultipleQuestion = QuizBaseQuestion & {
  type: "single" | "multiple";
  options: QuizOption[];
  correctOptionIds: string[];
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
  number: number;
  score: number;
  total: number;
  passed: boolean;
  completedAt: number;
};

type AttemptQuestionResult = {
  questionId: string;
  prompt: string;
  answerSummary: string;
  correctAnswerSummary: string;
  isAnswered: boolean;
  isCorrect: boolean;
  explanation: string;
};

type AttemptResult = {
  score: number;
  total: number;
  passed: boolean;
  attemptNumber: number;
  questionResults: AttemptQuestionResult[];
};

type StoredQuizState = {
  version?: number;
  attempts: AttemptRecord[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
  percentageWatched?: number;
};

type QuizAnswers = Record<string, string | string[] | Record<string, string>>;

const QUIZ_STORAGE_VERSION = 2;
const DEFAULT_QUIZ_TIME_LIMIT_SECONDS = 15 * 60;

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

type FetchedQuizOption = {
  id: string;
  question_id: string;
  option_text: string;
  is_correct: boolean;
  position: number;
  created_at?: string;
};

type FetchedQuizPair = {
  id: string;
  question_id: string;
  left_text: string;
  right_text: string;
  position: number;
  created_at?: string;
};

type FetchedQuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "matching";
  explanation: string;
  points: number;
  position: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  options: FetchedQuizOption[];
  pairs: FetchedQuizPair[];
};

const getStorageKey = (videoId: string) => `optiflowz-video-quiz:${videoId}`;

function getStoredAttempts(videoId: string): AttemptRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getStorageKey(videoId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as StoredQuizState;
    if (parsed?.version !== QUIZ_STORAGE_VERSION) {
      window.localStorage.removeItem(getStorageKey(videoId));
      return [];
    }
    return Array.isArray(parsed?.attempts) ? parsed.attempts : [];
  } catch {
    return [];
  }
}

function setStoredAttempts(videoId: string, attempts: AttemptRecord[]) {
  if (typeof window === "undefined") return;

  const payload: StoredQuizState = { version: QUIZ_STORAGE_VERSION, attempts };
  window.localStorage.setItem(getStorageKey(videoId), JSON.stringify(payload));
}

function formatTime(secondsLeft: number) {
  const safeSeconds = Math.max(0, secondsLeft);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function mapFetchedQuestion(question: FetchedQuizQuestion): QuizQuestion {
  if (question.question_type === "matching") {
    const sortedPairs = [...(question.pairs ?? [])].sort(
      (a, b) => Number(a.position || 0) - Number(b.position || 0)
    );

    const choices = sortedPairs.map((pair) => ({
      id: pair.id,
      label: pair.right_text,
    }));

    return {
      id: question.id,
      prompt: question.question_text,
      explanation: question.explanation,
      type: "match",
      choices,
      pairs: sortedPairs.map((pair) => ({
        id: pair.id,
        label: pair.left_text,
        correctChoiceId: pair.id,
      })),
    };
  }

  const sortedOptions = [...(question.options ?? [])].sort(
    (a, b) => Number(a.position || 0) - Number(b.position || 0)
  );

  return {
    id: question.id,
    prompt: question.question_text,
    explanation: question.explanation,
    type: question.question_type === "multiple_choice" ? "multiple" : "single",
    options: sortedOptions.map((option) => ({
      id: option.id,
      label: option.option_text,
    })),
    correctOptionIds: sortedOptions.filter((option) => option.is_correct).map((option) => option.id),
  };
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

function getAnswerSummary(question: QuizQuestion, answer: QuizAnswers[string]) {
  if (!answer) return "You haven't answered this question yet";

  if (question.type === "single") {
    const option = question.options.find((item) => item.id === answer);
    return option ? `Answered ${option.label}` : "You haven't answered this question yet";
  }

  if (question.type === "multiple") {
    if (!Array.isArray(answer) || answer.length === 0) {
      return "You haven't answered this question yet";
    }

    const selected = question.options
      .filter((item) => answer.includes(item.id))
      .map((item) => item.label);

    return selected.length > 0 ? `Answered ${selected.join(", ")}` : "You haven't answered this question yet";
  }

  if (typeof answer !== "object" || Array.isArray(answer)) {
    return "You haven't answered this question yet";
  }

  if (question.type !== "match") {
    return "You haven't answered this question yet";
  }

  const matched = question.pairs
    .map((pair) => {
      const choice = question.choices.find((item) => item.id === answer[pair.id]);
      return choice ? `${pair.label}: ${choice.label}` : null;
    })
    .filter(Boolean);

  return matched.length > 0 ? matched.join(" • ") : "You haven't answered this question yet";
}

function getCorrectSummary(question: QuizQuestion) {
  if (question.type === "match") {
    return question.pairs
      .map((pair) => {
        const choice = question.choices.find((item) => item.id === pair.correctChoiceId);
        return `${pair.label}: ${choice?.label ?? ""}`;
      })
      .join(" • ");
  }

  return question.options
    .filter((option) => question.correctOptionIds.includes(option.id))
    .map((option) => option.label)
    .join(", ");
}

function isCorrectAnswer(question: QuizQuestion, answer: QuizAnswers[string]) {
  if (question.type === "single") {
    return typeof answer === "string" && question.correctOptionIds[0] === answer;
  }

  if (question.type === "multiple") {
    if (!Array.isArray(answer)) return false;

    const normalizedAnswer = [...answer].sort().join("|");
    const normalizedCorrect = [...question.correctOptionIds].sort().join("|");
    return normalizedAnswer === normalizedCorrect;
  }

  if (question.type !== "match") return false;

  if (typeof answer !== "object" || Array.isArray(answer)) return false;
  return question.pairs.every((pair) => answer[pair.id] === pair.correctChoiceId);
}

function QuizStatusIcon({ passed }: { passed: boolean }) {
  return (
    <span className={`videoQuizStatusIcon ${passed ? "passed" : "failed"}`}>
      <svg viewBox="0 0 24 24" fill="none">
        {passed ? (
          <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
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

function VideoQuizPopup({
  open,
  onClose,
  videoId,
  videoTitle,
  percentageWatched = 0,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [stage, setStage] = useState<"intro" | "question" | "review" | "results">("intro");
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_QUIZ_TIME_LIMIT_SECONDS);
  const [latestResult, setLatestResult] = useState<AttemptResult | null>(null);
  const [questionMotionDirection, setQuestionMotionDirection] = useState<"forward" | "backward">("forward");
  const popupRef = useRef<HTMLDivElement | null>(null);
  const requestHeaders = useMemo(() => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");

    const token = getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  }, []);

  const { data: quizSummary, isLoading: isQuizSummaryLoading } = useQuery({
    queryKey: ["video-quiz-popup-summary", videoId],
    queryFn: () =>
      fetchFn<{ success: boolean; quiz?: VideoQuizSummary }>({
        route: `api/quizzes/${videoId}`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      })
        .then((response) => response.quiz ?? null)
        .catch((error: { status?: number }) => {
          if (error?.status === 404) return null;
          throw error;
        }),
    enabled: open && !!videoId,
    refetchOnWindowFocus: false,
  });
  const { data: fetchedQuestions = [], isLoading: areQuestionsLoading } = useQuery({
    queryKey: ["video-quiz-popup-questions", quizSummary?.id],
    queryFn: () =>
      fetchFn<{
        success: boolean;
        questions: FetchedQuizQuestion[];
      }>({
        route: `api/quizzes/${quizSummary!.id}/questions?page=1&limit=100&sortBy=position&sortOrder=asc`,
        options: {
          method: "GET",
          headers: requestHeaders,
        },
      }).then((response) => response.questions ?? []),
    enabled: open && !!quizSummary?.id,
    refetchOnWindowFocus: false,
  });

  const questions = useMemo(
    () =>
      [...fetchedQuestions]
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        .map(mapFetchedQuestion),
    [fetchedQuestions]
  );
  const quizTimeLimitSeconds = Math.max(1, Number(quizSummary?.time_limit_seconds) || DEFAULT_QUIZ_TIME_LIMIT_SECONDS);
  const quizPassingPercentage = Number(quizSummary?.passing_score_percentage) || 0;
  const quizMaxAttempts = Math.max(0, Number(quizSummary?.max_attempts) || 0);
  const quizDisplayTitle = quizSummary?.title || `${videoTitle} Quiz`;
  const attemptsLeft = Math.max(0, quizMaxAttempts - attempts.length);
  const answeredCount = questions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
  const currentQuestion = questions[currentQuestionIndex];
  const hasQuizQuestions = questions.length > 0;
  const isQuizLoading = isQuizSummaryLoading || areQuestionsLoading;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    setAttempts(getStoredAttempts(videoId));
    setStage("intro");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setDeadline(null);
    setSecondsLeft(quizTimeLimitSeconds);
    setLatestResult(null);
  }, [open, videoId, quizTimeLimitSeconds]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlPosition = document.documentElement.style.position;
    const previousHtmlWidth = document.documentElement.style.width;
    const previousHtmlHeight = document.documentElement.style.height;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyHeight = document.body.style.height;
    const previousBodyWidth = document.body.style.width;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.position = "fixed";
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.height = "100vh";
    document.body.style.width = "100%";
    document.body.style.overscrollBehavior = "none";
    document.body.style.touchAction = "none";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.position = previousHtmlPosition;
      document.documentElement.style.width = previousHtmlWidth;
      document.documentElement.style.height = previousHtmlHeight;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.height = previousBodyHeight;
      document.body.style.width = previousBodyWidth;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.body.style.touchAction = previousBodyTouchAction;
      document.body.style.paddingRight = previousPaddingRight;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !deadline || (stage !== "question" && stage !== "review")) return;

    const tick = () => {
      const nextSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(nextSeconds);

      if (nextSeconds <= 0) {
        finishAttempt();
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [deadline, open, stage]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => popupRef.current?.focus());
  }, [open, stage]);

  const startAttempt = () => {
    if (attemptsLeft <= 0 || !hasQuizQuestions) return;

    const now = Date.now();
    setQuestionMotionDirection("forward");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setLatestResult(null);
    setStage("question");
    setDeadline(now + quizTimeLimitSeconds * 1000);
    setSecondsLeft(quizTimeLimitSeconds);
  };

  const finishAttempt = () => {
    setDeadline(null);

    const questionResults = questions.map((question) => {
      const answer = answers[question.id];
      return {
        questionId: question.id,
        prompt: question.prompt,
        answerSummary: getAnswerSummary(question, answer),
        correctAnswerSummary: getCorrectSummary(question),
        isAnswered: isQuestionAnswered(question, answer),
        isCorrect: isCorrectAnswer(question, answer),
        explanation: question.explanation,
      };
    });

    const totalQuestions = questions.length;
    const score = questionResults.filter((result) => result.isCorrect).length;
    const passed = totalQuestions > 0 && (score / totalQuestions) * 100 >= quizPassingPercentage;
    const nextAttemptNumber = attempts.length + 1;
    const nextAttempt: AttemptRecord = {
      id: `${videoId}-${Date.now()}`,
      number: nextAttemptNumber,
      score,
      total: totalQuestions,
      passed,
      completedAt: Date.now(),
    };
    const nextAttempts = [...attempts, nextAttempt];

    setAttempts(nextAttempts);
    setStoredAttempts(videoId, nextAttempts);
    setLatestResult({
      score,
      total: totalQuestions,
      passed,
      attemptNumber: nextAttemptNumber,
      questionResults,
    });
    setStage("results");
  };

  const handleSingleChoiceSelect = (questionId: string, optionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: optionId }));
  };

  const handleMultipleChoiceToggle = (questionId: string, optionId: string) => {
    setAnswers((current) => {
      const previous = Array.isArray(current[questionId]) ? [...(current[questionId] as string[])] : [];
      const next = previous.includes(optionId)
        ? previous.filter((item) => item !== optionId)
        : [...previous, optionId];

      return { ...current, [questionId]: next };
    });
  };

  const handleMatchSelect = (questionId: string, pairId: string, optionId: string) => {
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
  };

  const goToFirstIncomplete = () => {
    const firstIncompleteIndex = questions.findIndex((question) => !isQuestionAnswered(question, answers[question.id]));
    setQuestionMotionDirection("backward");
    setCurrentQuestionIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0);
    setStage("question");
  };

  const goToQuestion = (nextIndex: number) => {
    setQuestionMotionDirection(nextIndex >= currentQuestionIndex ? "forward" : "backward");
    setCurrentQuestionIndex(nextIndex);
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
                  onChange={(event) =>
                    handleMatchSelect(currentQuestion.id, pair.id, event.target.value)
                  }
                >
                  <option value="">Choose an answer</option>
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

  if (!open || !mounted) return null;

  return createPortal(
    <div className={`popup videoQuizPopup ${open ? "active" : ""}`}>
      <div
        className="closePopup"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={popupRef}
        className={`videoQuizPopupContent ${stage === "intro" ? "introStage" : ""} ${stage === "results" ? "resultsStage" : ""} ${stage === "question" || stage === "review" ? "flowStage" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${videoTitle} quiz`}
        tabIndex={-1}
      >
        <div className="videoQuizTop">
          <div className="videoQuizHeading">
            <span className="videoQuizBadge">{QuizSVG}</span>
            <span>
              <h2>{quizDisplayTitle}</h2>
              <p>
                Certificate when completed • {questions.length} questions • {Math.max(1, Math.round(quizTimeLimitSeconds / 60))} minutes
              </p>
            </span>
          </div>

          <div className="videoQuizTopActions">
            {(stage === "question" || stage === "review") && (
              <span className={`videoQuizTimer ${secondsLeft <= 60 ? "urgent" : ""}`}>
                <span>Time left:</span> <AnimatedTimer secondsLeft={secondsLeft} />
              </span>
            )}

            <button type="button" onClick={onClose} className="videoQuizCloseButton" aria-label="Close quiz">
              {CloseSVG}
            </button>
          </div>
        </div>

        <div key={stage} className="videoQuizStageTransition">
          {stage === "intro" ? (
            <div className="videoQuizIntro">
              <div className="videoQuizSectionTitle">
                <h3>Your last attempts</h3>
                <p>{quizMaxAttempts > 0 ? `${attemptsLeft} attempts left` : "Attempts will appear here"}</p>
              </div>

              {isQuizLoading ? (
                <div className="videoQuizEmptyState">
                  <strong>Loading quiz</strong>
                  <p>Questions are being prepared for this video.</p>
                </div>
              ) : attempts.length > 0 ? (
                <div className="videoQuizAttemptList">
                  {[...attempts].reverse().map((attempt) => (
                    <div key={attempt.id} className="videoQuizAttemptCard">
                      <QuizStatusIcon passed={attempt.passed} />

                      <div>
                        <strong>Attempt {attempt.number}</strong>
                        <p>
                          You scored {attempt.score}/{attempt.total}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="videoQuizEmptyState">
                  <strong>No attempts yet</strong>
                  <p>Start your first quiz attempt when you are ready.</p>
                </div>
              )}

              {!isQuizLoading && !quizSummary ? (
                <div className="videoQuizUnlockNotice">
                  <strong>No quiz available</strong>
                  <p>This video does not have a quiz yet.</p>
                </div>
              ) : null}

              {!isQuizLoading && quizSummary && !hasQuizQuestions ? (
                <div className="videoQuizUnlockNotice">
                  <strong>No questions yet</strong>
                  <p>The quiz exists, but questions have not been added yet.</p>
                </div>
              ) : null}

              {quizMaxAttempts > 0 && attemptsLeft === 0 ? (
                <div className="videoQuizUnlockNotice">
                  <strong>No attempts left</strong>
                  <p>You have used all {quizMaxAttempts} attempts in this temporary local version.</p>
                </div>
              ) : null}

              <div className="videoQuizFooterActions">
                <button type="button" className="videoQuizGhostButton" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="videoQuizPrimaryButton"
                  onClick={startAttempt}
                  disabled={isQuizLoading || !quizSummary || !hasQuizQuestions || (quizMaxAttempts > 0 && attemptsLeft <= 0)}
                >
                  Attempt {ArrowSVG}
                </button>
              </div>
            </div>
          ) : null}

          {stage === "question" || stage === "review" ? (
            <div className="videoQuizShell">
              <aside className="videoQuizSidebar">
                <h3>Questions</h3>
                <p>
                  {answeredCount}/{questions.length} answered
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
                        onClick={() => goToQuestion(index)}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="videoQuizReviewLink"
                  onClick={() => setStage("review")}
                >
                  Finish Attempt...
                </button>
              </aside>

              {stage === "question" ? (
                <section className="videoQuizQuestionPanel">
                  <div
                    key={currentQuestion.id}
                    className={`videoQuizQuestionTransition ${questionMotionDirection}`}
                  >
                    <div className="videoQuizQuestionHeader">
                      <span className="videoQuizQuestionNumber">{currentQuestionIndex + 1}</span>
                      <div>
                        <h3>{currentQuestion.prompt}</h3>
                        <p>{currentQuestion.type === "single" ? "Single choice" : currentQuestion.type === "multiple" ? "Multiple choice" : "Match concepts"}</p>
                      </div>
                    </div>

                    {renderQuestionContent()}
                  </div>

                  <div className="videoQuizActionRow">
                    {currentQuestionIndex > 0 ? (
                      <button
                        type="button"
                        className="videoQuizGhostButton"
                        onClick={() => {
                          setQuestionMotionDirection("backward");
                          setCurrentQuestionIndex((index) => Math.max(0, index - 1));
                        }}
                      >
                        Previous Question
                      </button>
                    ) : null}

                    {currentQuestionIndex < questions.length - 1 ? (
                      <button
                        type="button"
                        className="videoQuizPrimaryButton"
                        onClick={() => {
                          setQuestionMotionDirection("forward");
                          setCurrentQuestionIndex((index) => Math.min(questions.length - 1, index + 1));
                        }}
                      >
                        Next Question {ArrowSVG}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="videoQuizPrimaryButton"
                        onClick={() => setStage("review")}
                      >
                        Review Attempt {ArrowSVG}
                      </button>
                    )}
                  </div>
                </section>
              ) : (
                <section className="videoQuizReviewPanel">
                  <h3>Answered all questions?</h3>

                  <div className="videoQuizReviewList">
                    {questions.map((question, index) => {
                      const answer = answers[question.id];
                      const answered = isQuestionAnswered(question, answer);

                      return (
                        <div key={question.id} className={`videoQuizReviewCard ${answered ? "" : "unanswered"}`}>
                          <strong>{index + 1}.</strong>
                          <span>{getAnswerSummary(question, answer)}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="videoQuizActionRow">
                    <button type="button" className="videoQuizGhostButton" onClick={goToFirstIncomplete}>
                      Back to quiz
                    </button>
                    <button type="button" className="videoQuizPrimaryButton" onClick={finishAttempt}>
                      Finish attempt
                    </button>
                  </div>
                </section>
              )}
            </div>
          ) : null}

          {stage === "results" && latestResult ? (
            <div className="videoQuizResults">
              <div className="videoQuizResultHeadline">
                <h3>{latestResult.passed ? "Congrats!" : "Quiz complete"}</h3>
                <p>
                  You answered {latestResult.score}/{latestResult.total} questions right.
                </p>
              </div>

              <div className="videoQuizResultList">
                {latestResult.questionResults.map((result, index) => (
                  <div
                    key={result.questionId}
                    className={`videoQuizResultCard ${result.isCorrect ? "correct" : "incorrect"}`}
                  >
                    <QuizStatusIcon passed={result.isCorrect} />

                    <div className="videoQuizResultCardText">
                      <strong>
                        {index + 1}. {result.answerSummary}
                      </strong>

                      {!result.isCorrect ? (
                        <p>
                          Correct answer: {result.correctAnswerSummary}. {result.explanation}
                        </p>
                      ) : null}
                    </div>

                    {!result.isCorrect ? (
                      <button
                        type="button"
                        className="videoQuizInlineButton"
                        onClick={onClose}
                      >
                        View in video
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="videoQuizFooterActions">
                <button type="button" className="videoQuizGhostButton" onClick={onClose}>
                  Close quiz
                </button>
                <button
                  type="button"
                  className="videoQuizPrimaryButton"
                  onClick={startAttempt}
                  disabled={isQuizLoading || !quizSummary || !hasQuizQuestions || (quizMaxAttempts > 0 && attempts.length >= quizMaxAttempts)}
                >
                  Attempt again {ArrowSVG}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default VideoQuizPopup;
