import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSVG, CloseSVG, IconChevron, QuizSVG } from "~/constants";

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

const QUIZ_TIME_LIMIT_SECONDS = 15 * 60;
const QUIZ_PASSING_PERCENTAGE = 50;
const QUIZ_MAX_ATTEMPTS = 15;
const QUIZ_UNLOCK_PERCENTAGE = 50;
const QUIZ_STORAGE_VERSION = 2;

const getStorageKey = (videoId: string) => `optiflowz-video-quiz:${videoId}`;

const createMockQuestions = (videoTitle: string): QuizQuestion[] => [
  {
    id: "q1",
    type: "single",
    prompt: `What is the main goal of the "${videoTitle}" quiz?`,
    explanation: "The quiz checks whether the learner understood the key ideas presented in the video.",
    options: [
      { id: "a", label: "To rate the video production quality" },
      { id: "b", label: "To test understanding of the video content" },
      { id: "c", label: "To unlock unrelated videos in the library" },
      { id: "d", label: "To replace the full lecture notes" },
    ],
    correctOptionIds: ["b"],
  },
  {
    id: "q2",
    type: "multiple",
    prompt: "Which actions usually help a learner prepare for a post-video quiz?",
    explanation: "Reviewing objectives, taking notes, and revisiting key timestamps are all useful preparation habits.",
    options: [
      { id: "a", label: "Review the learning objectives" },
      { id: "b", label: "Skip directly to the final minute only" },
      { id: "c", label: "Take notes on important decisions or definitions" },
      { id: "d", label: "Replay the important moments before submitting" },
    ],
    correctOptionIds: ["a", "c", "d"],
  },
  {
    id: "q3",
    type: "match",
    prompt: "Match each quiz element to its role in the learner flow.",
    explanation: "The question navigator tracks progress, the timer preserves pacing, and the results view explains what to review.",
    choices: [
      { id: "progress", label: "Shows answered and current items" },
      { id: "timer", label: "Limits how long the attempt can stay open" },
      { id: "results", label: "Summarizes score and feedback after submission" },
    ],
    pairs: [
      { id: "p1", label: "Question navigator", correctChoiceId: "progress" },
      { id: "p2", label: "Attempt timer", correctChoiceId: "timer" },
      { id: "p3", label: "Results screen", correctChoiceId: "results" },
    ],
  },
  {
    id: "q4",
    type: "single",
    prompt: "What happens when an answer is changed before the attempt is finished?",
    explanation: "Before submission, the current answer state remains editable and the newest selection is used.",
    options: [
      { id: "a", label: "The first answer is locked forever" },
      { id: "b", label: "The newest answer replaces the previous one" },
      { id: "c", label: "The question is deleted from the attempt" },
      { id: "d", label: "The timer resets to the full duration" },
    ],
    correctOptionIds: ["b"],
  },
  {
    id: "q5",
    type: "multiple",
    prompt: "Which states are visible in the popup flow?",
    explanation: "The current UI includes an intro state, the active question flow, a review screen, and a results screen.",
    options: [
      { id: "a", label: "Intro / attempts overview" },
      { id: "b", label: "Question answering view" },
      { id: "c", label: "Review before final submit" },
      { id: "d", label: "Final results with feedback" },
    ],
    correctOptionIds: ["a", "b", "c", "d"],
  },
  {
    id: "q6",
    type: "single",
    prompt: `When does the quiz unlock for "${videoTitle}" in this prototype?`,
    explanation: "The unlock rule is based on watch progress so the quiz opens once the learner reaches the configured threshold.",
    options: [
      { id: "a", label: "After watching 10% of the video" },
      { id: "b", label: "After watching 25% of the video" },
      { id: "c", label: "After watching 50% of the video" },
      { id: "d", label: "Only after the whole video ends" },
    ],
    correctOptionIds: ["c"],
  },
  {
    id: "q7",
    type: "match",
    prompt: "Match the question type to the expected answer behavior.",
    explanation: "Single choice uses one option, multiple choice uses several options, and match uses one answer per row.",
    choices: [
      { id: "one", label: "Select exactly one answer" },
      { id: "many", label: "Select more than one answer" },
      { id: "row", label: "Choose one option for each row" },
    ],
    pairs: [
      { id: "p1", label: "Single choice", correctChoiceId: "one" },
      { id: "p2", label: "Multiple choice", correctChoiceId: "many" },
      { id: "p3", label: "Match concepts", correctChoiceId: "row" },
    ],
  },
  {
    id: "q8",
    type: "single",
    prompt: "Why is a review screen helpful before final submission?",
    explanation: "It lets the learner spot unanswered questions and make last changes before locking the attempt.",
    options: [
      { id: "a", label: "It automatically changes incorrect answers" },
      { id: "b", label: "It highlights unanswered or uncertain items" },
      { id: "c", label: "It removes the attempt limit" },
      { id: "d", label: "It publishes the score to other users" },
    ],
    correctOptionIds: ["b"],
  },
  {
    id: "q9",
    type: "multiple",
    prompt: "Which details are shown on the intro screen before starting an attempt?",
    explanation: "The intro stage summarizes the quiz, lists previous attempts, and shows how many attempts remain.",
    options: [
      { id: "a", label: "Quiz title and time limit" },
      { id: "b", label: "Previous attempt scores" },
      { id: "c", label: "Attempts left" },
      { id: "d", label: "A hidden admin-only answer key" },
    ],
    correctOptionIds: ["a", "b", "c"],
  },
  {
    id: "q10",
    type: "single",
    prompt: "What is stored locally in this temporary implementation until the API is ready?",
    explanation: "Attempts are persisted in localStorage so the popup can still show prior scores between opens.",
    options: [
      { id: "a", label: "Nothing is remembered after closing" },
      { id: "b", label: "Only the open/closed state of the popup" },
      { id: "c", label: "Previous attempts and scores for this video" },
      { id: "d", label: "Every second of the video playback session" },
    ],
    correctOptionIds: ["c"],
  },
];

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
  const [secondsLeft, setSecondsLeft] = useState(QUIZ_TIME_LIMIT_SECONDS);
  const [latestResult, setLatestResult] = useState<AttemptResult | null>(null);
  const [questionMotionDirection, setQuestionMotionDirection] = useState<"forward" | "backward">("forward");
  const popupRef = useRef<HTMLDivElement | null>(null);

  const questions = useMemo(() => createMockQuestions(videoTitle), [videoTitle]);
  const attemptsLeft = Math.max(0, QUIZ_MAX_ATTEMPTS - attempts.length);
  const isUnlocked = percentageWatched >= QUIZ_UNLOCK_PERCENTAGE;
  const answeredCount = questions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
  const currentQuestion = questions[currentQuestionIndex];

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
    setSecondsLeft(QUIZ_TIME_LIMIT_SECONDS);
    setLatestResult(null);
  }, [open, videoId]);

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
    if (!isUnlocked || attemptsLeft <= 0) return;

    const now = Date.now();
    setQuestionMotionDirection("forward");
    setAnswers({});
    setCurrentQuestionIndex(0);
    setLatestResult(null);
    setStage("question");
    setDeadline(now + QUIZ_TIME_LIMIT_SECONDS * 1000);
    setSecondsLeft(QUIZ_TIME_LIMIT_SECONDS);
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

    const score = questionResults.filter((result) => result.isCorrect).length;
    const passed = (score / questions.length) * 100 >= QUIZ_PASSING_PERCENTAGE;
    const nextAttemptNumber = attempts.length + 1;
    const nextAttempt: AttemptRecord = {
      id: `${videoId}-${Date.now()}`,
      number: nextAttemptNumber,
      score,
      total: questions.length,
      passed,
      completedAt: Date.now(),
    };
    const nextAttempts = [...attempts, nextAttempt];

    setAttempts(nextAttempts);
    setStoredAttempts(videoId, nextAttempts);
    setLatestResult({
      score,
      total: questions.length,
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
              <h2>{videoTitle} - Quiz</h2>
              <p>
                Certificate when completed • {questions.length} questions • {QUIZ_TIME_LIMIT_SECONDS / 60} minutes
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
                <p>{attemptsLeft} attempts left</p>
              </div>

              {attempts.length > 0 ? (
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

              {!isUnlocked ? (
                <div className="videoQuizUnlockNotice">
                  <strong>Quiz locked for now</strong>
                  <p>
                    Watch at least {QUIZ_UNLOCK_PERCENTAGE}% of the video to unlock the quiz. You are currently at{" "}
                    {Math.round(percentageWatched)}%.
                  </p>
                </div>
              ) : null}

              {attemptsLeft === 0 ? (
                <div className="videoQuizUnlockNotice">
                  <strong>No attempts left</strong>
                  <p>You have used all {QUIZ_MAX_ATTEMPTS} attempts in this temporary local version.</p>
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
                  disabled={!isUnlocked || attemptsLeft <= 0}
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
                  disabled={attempts.length >= QUIZ_MAX_ATTEMPTS}
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
